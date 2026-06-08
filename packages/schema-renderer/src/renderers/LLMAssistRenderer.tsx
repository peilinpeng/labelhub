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
  const suggestionItems = buildSuggestionItems(response?.suggestedPatch, renderContext.answers);
  const aiJudgement = getAiJudgement(response?.output);

  return (
    <section className="ai-quality-panel" data-node-id={node.id}>
      <div className="ai-quality-panel__header">
        <div>
          <span className="ai-quality-panel__eyebrow">AI Assist</span>
          <h3>AI 质量检查建议</h3>
          {node.description !== undefined ? <p>{node.description}</p> : null}
        </div>
        <button
          className="ai-quality-panel__trigger"
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
          {loading ? "检查中..." : "检查质量"}
        </button>
      </div>
      {error !== undefined ? <div className="ai-quality-panel__error" role="alert">{error}</div> : null}
      {response !== undefined ? (
        <div className="ai-quality-panel__body">
          <section className="ai-quality-panel__judgement" aria-label="AI 判断">
            <span>AI 判断</span>
            <p>{aiJudgement}</p>
          </section>
          {suggestionItems.length > 0 ? (
            <section className="ai-quality-panel__suggestions" aria-label="建议修改">
              <h4>建议修改</h4>
              <ul>
                {suggestionItems.map((item) => (
                  <li key={item.fieldName}>
                    <div className="ai-quality-panel__field">
                      <strong>{item.label}</strong>
                      {item.label !== item.fieldName ? <small>{item.fieldName}</small> : null}
                    </div>
                    <div className="ai-quality-panel__diff">
                      <span>{item.currentValue}</span>
                      <em aria-hidden="true">→</em>
                      <span>{item.suggestedValue}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <div className="ai-quality-panel__notice">
              AI 建议仅供参考，请根据判断手动补充相关说明后继续标注。
            </div>
          )}
        </div>
      ) : null}
      {response !== undefined && preflightResult !== undefined ? (
        <PreflightStatusBlock result={preflightResult} patchFieldNames={patchFieldNames} />
      ) : null}
      {response !== undefined ? (
        <div className="ai-quality-panel__actions">
          {hasSuggestedPatch ? (
            <button
              className="ai-quality-panel__apply"
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
              一键采纳
            </button>
          ) : null}
          <button
            className="ai-quality-panel__feedback"
            disabled
            title="反馈功能暂未接入，请先手动调整本题答案。"
            type="button"
          >
            反馈问题
          </button>
        </div>
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
      <div className="ai-quality-preflight__meta">涉及 {patchFieldNames.length} 处建议修改</div>
    ) : null;

  if (status === "SAFE") {
    return (
      <div className="ai-quality-preflight ai-quality-preflight--safe" data-preflight-status="SAFE" role="status">
        <strong>可以一键采纳</strong>
        <p>这条建议可以直接应用，你也可以继续手动调整。</p>
        {fieldSummary}
      </div>
    );
  }

  if (status === "WARNING") {
    return (
      <div className="ai-quality-preflight ai-quality-preflight--warning" data-preflight-status="WARNING" role="status">
        <strong>建议采纳前再确认</strong>
        <p>这条建议会影响部分已填写内容，请确认无误后再一键采纳。</p>
        {fieldSummary}
        {result.clearedFieldNames.length > 0 ? (
          <div className="ai-quality-preflight__meta">部分内容可能需要重新确认</div>
        ) : null}
        {result.hiddenFieldNames.length > 0 ? (
          <div className="ai-quality-preflight__meta">部分输入项会暂时不显示</div>
        ) : null}
        {result.disabledFieldNames.length > 0 ? (
          <div className="ai-quality-preflight__meta">部分输入项会暂时不可编辑</div>
        ) : null}
      </div>
    );
  }

  // BLOCKED
  return (
    <div className="ai-quality-preflight ai-quality-preflight--blocked" data-preflight-status="BLOCKED" role="alert">
      <strong>AI 建议还需要补充信息</strong>
      <p>该建议还不能直接采纳，请根据建议手动补充相关说明后继续标注。</p>
      {fieldSummary}
      {result.requiredMissingFieldNames.length > 0 ? (
        <div className="ai-quality-preflight__meta">建议先补充必要说明，再提交本题。</div>
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

function getAiJudgement(output: unknown): string {
  if (typeof output === "string" && output.trim().length > 0) return output.trim();
  if (isRecord(output)) {
    const summary = output["summary"];
    if (typeof summary === "string" && summary.trim().length > 0) return summary.trim();
    const message = output["message"];
    if (typeof message === "string" && message.trim().length > 0) return message.trim();
  }
  return "这条内容建议进一步核对来源依据，并补充必要说明。";
}

function buildSuggestionItems(
  patch: AnswerPayload | undefined,
  answers: AnswerPayload,
): Array<{ fieldName: string; label: string; currentValue: string; suggestedValue: string }> {
  if (patch === undefined) return [];
  return Object.entries(patch)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fieldName, value]) => ({
      fieldName,
      label: fieldLabel(fieldName),
      currentValue: formatAnswerValue(answers[fieldName]),
      suggestedValue: formatAnswerValue(value),
    }));
}

function fieldLabel(fieldName: string): string {
  const labels: Record<string, string> = {
    qualityScore: "质量评分",
    rewriteSuggestion: "修改建议",
    factCheckNote: "事实核查说明",
  };
  return labels[fieldName] ?? fieldName;
}

function formatAnswerValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "（空）";
  if (Array.isArray(value)) return value.length > 0 ? value.map((item) => formatPrimitiveValue(item)).join("、") : "（空）";
  if (typeof value === "object") return "已填写";
  return formatPrimitiveValue(value);
}

function formatPrimitiveValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
