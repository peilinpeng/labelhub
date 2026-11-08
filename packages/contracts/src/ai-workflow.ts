import type { LabelHubRuntimeContext } from "./global";
import type { AnswerPayload } from "./workflow";
import type { LabelHubSchema } from "./schema";
import type { ModelSnapshot, ReviewDimension } from "./review";

/** 服务端与共享校验子进程使用；不暴露新的 HTTP 写入口。 */
export interface AIAssistEngineInput {
  action: "PREPARE" | "VALIDATE";
  schema: LabelHubSchema;
  context: LabelHubRuntimeContext;
  nodeId: string;
  output?: unknown;
}
export interface AIAssistEngineResult {
  bindings: Record<string, unknown>;
  missingInputs: string[];
  suggestedPatch: AnswerPayload | null;
}
export interface AIReviewWorkflowSnapshot {
  version: "ai-workflow-v1";
  context: {
    task: { id: string; title: string; description: string | null; instructionRichText: unknown };
    item: { sourcePayload: Record<string, unknown> };
    submission: { answers: AnswerPayload; attemptNo: number };
    schema: LabelHubSchema;
    dimensions: ReviewDimension[];
    thresholds: Record<string, number>;
  };
  promptTemplate: string;
  modelPolicyId: string;
  model: ModelSnapshot;
  flowMode: string;
  confidenceThreshold: number;
}
