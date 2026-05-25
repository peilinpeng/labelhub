import type { AnswerPayload, LLMAssistNode, LLMRuntimeResponse } from "@labelhub/contracts";
import { normalizeAnswers } from "@labelhub/schema-core";
import { useState } from "react";
import type { RenderNodeContext } from "../types";

export interface LLMAssistRendererProps {
  node: LLMAssistNode;
  renderContext: RenderNodeContext;
}

export function LLMAssistRenderer({ node, renderContext }: LLMAssistRendererProps) {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<LLMRuntimeResponse | undefined>();
  const [error, setError] = useState<string | undefined>();
  const canApply = response?.suggestedPatch !== undefined && requireUserConfirm(node);

  return (
    <section data-node-id={node.id}>
      <h3>{node.title}</h3>
      {node.description !== undefined ? <p>{node.description}</p> : null}
      <button
        disabled={renderContext.readonly || loading || renderContext.onLLMAssist === undefined}
        type="button"
        onClick={() => {
          void runLLMAssist(node, renderContext, setLoading, setResponse, setError);
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
          }}
        >
          确认应用建议
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
): Promise<void> {
  if (renderContext.onLLMAssist === undefined) {
    return;
  }

  setLoading(true);
  setError(undefined);
  try {
    const result = await renderContext.onLLMAssist(node, renderContext.context, renderContext.answers);
    setResponse(result);
  } catch {
    setError("AI 辅助调用失败");
  } finally {
    setLoading(false);
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
