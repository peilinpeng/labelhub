import type { AnswerPayload, LLMAssistNode, LLMRuntimeResponse } from "@labelhub/contracts";
import { normalizeAnswers } from "@labelhub/schema-core";
import { runSchemaPreflight } from "@labelhub/schema-compiler";
import type { PreflightPatchOperation, PreflightResult } from "@labelhub/schema-compiler";
import { useRef, useState } from "react";
import type { LLMAssistOutcome, RenderNodeContext } from "../types";

export interface LLMAssistRendererProps {
  node: LLMAssistNode;
  renderContext: RenderNodeContext;
}

type PreflightUiStatus = "SAFE" | "WARNING" | "BLOCKED";

// ---------------------------------------------------------------------------
// 公开工具函数（供测试直接验证）
// ---------------------------------------------------------------------------

export function convertSuggestedPatchToPreflightPatch(patch: AnswerPayload): PreflightPatchOperation[] {
  return Object.entries(patch).map(([fieldName, value]) =>
    value === undefined
      ? { op: "unset" as const, fieldName }
      : { op: "set" as const, fieldName, value },
  );
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function LLMAssistRenderer({ node, renderContext }: LLMAssistRendererProps) {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<LLMRuntimeResponse | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [preflightResult, setPreflightResult] = useState<PreflightResult | undefined>();
  const notifiedOutcomesRef = useRef<Set<string>>(new Set());

  // 空对象 patch（AI 未给出任何字段建议）不应渲染可点的"确认应用"按钮——否则会
  // 跳过 preflight（其判定也以 length > 0 为准）却仍可点击，应用空操作并误记 ACCEPTED。
  const hasSuggestedPatch =
    response?.suggestedPatch !== undefined &&
    Object.keys(response.suggestedPatch).length > 0 &&
    requireUserConfirm(node);
  const preflightBlocked = preflightResult !== undefined && !preflightResult.ok;
  const canApply = hasSuggestedPatch && !preflightBlocked;
  const patchFieldNames = Object.keys(response?.suggestedPatch ?? {}).sort();

  return (
    <section data-node-id={node.id}>
      <h3>{node.title}</h3>
      {node.description !== undefined ? <p>{node.description}</p> : null}
      <button
        disabled={renderContext.readonly || loading || renderContext.onLLMAssist === undefined}
        type="button"
        onClick={() => {
          void runLLMAssist(
            node,
            renderContext,
            setLoading,
            setResponse,
            setError,
            setPreflightResult,
            notifiedOutcomesRef.current,
          );
        }}
      >
        {loading ? "生成中" : "AI 辅助"}
      </button>
      {error !== undefined ? <div role="alert">{error}</div> : null}
      {response !== undefined ? <pre>{formatValue(response.output)}</pre> : null}
      {response !== undefined && preflightResult !== undefined ? (
        <PreflightStatusBlock result={preflightResult} patchFieldNames={patchFieldNames} />
      ) : null}
      {hasSuggestedPatch ? (
        <button
          disabled={!canApply}
          type="button"
          onClick={() => {
            if (!canApply) return;
            const patch = response?.suggestedPatch;
            if (patch === undefined) return;
            const nextAnswers = { ...renderContext.answers, ...patch };
            const normalized = normalizeAnswers(renderContext.schema, nextAnswers, {
              ...renderContext.context,
              answers: nextAnswers,
            });
            renderContext.onApplySuggestedPatch(normalized.answers);
            notifyAssistOutcome(renderContext, notifiedOutcomesRef.current, {
              callId: response?.callId ?? "",
              nodeId: node.id,
              action: "ACCEPTED",
              appliedPatchFieldNames: Object.keys(patch).sort(),
            });
            setResponse(undefined);
            setPreflightResult(undefined);
          }}
        >
          确认应用建议
        </button>
      ) : null}
      {response !== undefined ? (
        <button
          type="button"
          onClick={() => {
            notifyAssistOutcome(renderContext, notifiedOutcomesRef.current, {
              callId: response.callId,
              nodeId: node.id,
              action: "DISMISSED",
            });
            setResponse(undefined);
            setError(undefined);
            setPreflightResult(undefined);
          }}
        >
          忽略建议
        </button>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Preflight 状态展示组件
// ---------------------------------------------------------------------------

function PreflightStatusBlock({
  result,
  patchFieldNames,
}: {
  result: PreflightResult;
  patchFieldNames: string[];
}) {
  const status = resolvePreflightUiStatus(result);

  const fieldSummary =
    patchFieldNames.length > 0 ? (
      <div>将更新字段：{patchFieldNames.join("、")}</div>
    ) : null;

  if (status === "SAFE") {
    return (
      <div data-preflight-status="SAFE" role="status">
        <div>✅ 预检通过</div>
        <div>本次建议不会新增必填缺失、非法字段或隐藏清空风险。</div>
        {fieldSummary}
      </div>
    );
  }

  if (status === "WARNING") {
    return (
      <div data-preflight-status="WARNING" role="status">
        <div>⚠️ 预检发现影响</div>
        <div>本次建议可以应用，但会影响部分字段。</div>
        {fieldSummary}
        {result.warnings.length > 0 ? (
          <ul>
            {result.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        ) : null}
        {result.clearedFieldNames.length > 0 ? (
          <div>将被清空：{result.clearedFieldNames.join("、")}</div>
        ) : null}
        {result.hiddenFieldNames.length > 0 ? (
          <div>将被隐藏：{result.hiddenFieldNames.join("、")}</div>
        ) : null}
        {result.disabledFieldNames.length > 0 ? (
          <div>将被禁用：{result.disabledFieldNames.join("、")}</div>
        ) : null}
      </div>
    );
  }

  // BLOCKED
  return (
    <div data-preflight-status="BLOCKED" role="alert">
      <div>⛔ 预检阻断</div>
      <div>本次建议会新增无法满足的表单规则，因此不能直接应用。</div>
      {fieldSummary}
      {result.errors.length > 0 ? (
        <ul>
          {result.errors.map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      ) : null}
      {result.requiredMissingFieldNames.length > 0 ? (
        <div>必填字段缺失：{result.requiredMissingFieldNames.join("、")}</div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function resolvePreflightUiStatus(result: PreflightResult): PreflightUiStatus {
  if (result.errors.length > 0) return "BLOCKED";
  if (result.warnings.length > 0) return "WARNING";
  return "SAFE";
}

async function runLLMAssist(
  node: LLMAssistNode,
  renderContext: RenderNodeContext,
  setLoading: (value: boolean) => void,
  setResponse: (value: LLMRuntimeResponse | undefined) => void,
  setError: (value: string | undefined) => void,
  setPreflightResult: (value: PreflightResult | undefined) => void,
  notifiedOutcomes: Set<string>,
): Promise<void> {
  if (renderContext.onLLMAssist === undefined) return;

  // 每次新调用前清空旧 preflight 结果，避免残留
  setPreflightResult(undefined);
  setLoading(true);
  setError(undefined);

  try {
    const result = await renderContext.onLLMAssist(node, renderContext.context, renderContext.answers);
    setResponse(result);

    // 有 suggestedPatch 且非空时执行 preflight
    const patch = result.suggestedPatch;
    if (patch !== undefined && Object.keys(patch).length > 0) {
      const ops = convertSuggestedPatchToPreflightPatch(patch);
      const preflight = runSchemaPreflight({
        schema: renderContext.schema,
        currentAnswers: renderContext.answers,
        patch: ops,
      });
      setPreflightResult(preflight);
    }

    notifyAssistOutcome(renderContext, notifiedOutcomes, {
      callId: result.callId,
      nodeId: node.id,
      action: "SHOWN",
    });
  } catch {
    setError("AI 辅助调用失败");
  } finally {
    setLoading(false);
  }
}

function notifyAssistOutcome(
  renderContext: RenderNodeContext,
  notifiedOutcomes: Set<string>,
  outcome: LLMAssistOutcome,
): void {
  if (outcome.callId.length === 0) return;
  const key = `${outcome.callId}:${outcome.action}`;
  if (notifiedOutcomes.has(key)) return;
  notifiedOutcomes.add(key);
  try {
    renderContext.onAssistOutcome?.(outcome);
  } catch (error) {
    console.warn("AI 辅助交互结果回调失败：", error);
  }
}

function requireUserConfirm(node: LLMAssistNode): boolean {
  return (node.outputBindings ?? []).every((binding) => binding.requireUserConfirm === true);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}
