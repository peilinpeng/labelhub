import type { LLMAssistNode, LLMRuntimeResponse } from "@labelhub/contracts";
import { normalizeAnswers } from "@labelhub/schema-core";
import { useRef, useState } from "react";
import type { LLMAssistOutcome, RenderNodeContext } from "../types";

export interface LLMAssistRendererProps {
  node: LLMAssistNode;
  renderContext: RenderNodeContext;
}

export function LLMAssistRenderer({ node, renderContext }: LLMAssistRendererProps) {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<LLMRuntimeResponse | undefined>();
  const [error, setError] = useState<string | undefined>();
  const notifiedOutcomesRef = useRef<Set<string>>(new Set());
  const canApply = response?.suggestedPatch !== undefined && requireUserConfirm(node);

  return (
    <section data-node-id={node.id}>
      <h3>{node.title}</h3>
      {node.description !== undefined ? <p>{node.description}</p> : null}
      <button
        disabled={renderContext.readonly || loading || renderContext.onLLMAssist === undefined}
        type="button"
        onClick={() => {
          void runLLMAssist(node, renderContext, setLoading, setResponse, setError, notifiedOutcomesRef.current);
        }}
      >
        {loading ? "生成中" : "AI 辅助"}
      </button>
      {error !== undefined ? <div role="alert">{error}</div> : null}
      {response !== undefined ? <pre>{formatValue(response.output)}</pre> : null}
      {canApply ? (
        <button
          type="button"
          onClick={() => {
            const patch = response.suggestedPatch;
            if (patch === undefined) {
              return;
            }
            const nextAnswers = { ...renderContext.answers, ...patch };
            const normalized = normalizeAnswers(renderContext.schema, nextAnswers, {
              ...renderContext.context,
              answers: nextAnswers,
            });
            renderContext.onApplySuggestedPatch(normalized.answers);
            notifyAssistOutcome(renderContext, notifiedOutcomesRef.current, {
              callId: response.callId,
              nodeId: node.id,
              action: "ACCEPTED",
              appliedPatchFieldNames: Object.keys(patch).sort(),
            });
            setResponse(undefined);
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
          }}
        >
          忽略建议
        </button>
      ) : null}
    </section>
  );
}

async function runLLMAssist(
  node: LLMAssistNode,
  renderContext: RenderNodeContext,
  setLoading: (value: boolean) => void,
  setResponse: (value: LLMRuntimeResponse | undefined) => void,
  setError: (value: string | undefined) => void,
  notifiedOutcomes: Set<string>,
): Promise<void> {
  if (renderContext.onLLMAssist === undefined) {
    return;
  }

  setLoading(true);
  setError(undefined);
  try {
    const result = await renderContext.onLLMAssist(node, renderContext.context, renderContext.answers);
    setResponse(result);
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
  if (outcome.callId.length === 0) {
    return;
  }
  const key = `${outcome.callId}:${outcome.action}`;
  if (notifiedOutcomes.has(key)) {
    return;
  }
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
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}
