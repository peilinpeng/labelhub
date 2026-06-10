import type { Actor, ID, ISODateTime } from "./global";
import type { Expression, PublishedLabelHubSchema } from "./schema";
import type { DatasetItem, Submission, Task } from "./workflow";

export type ReviewPolicy =
  | { type: "SINGLE_REVIEW" }
  | { type: "DOUBLE_REVIEW"; requireFinalReview: true };

export type ReviewStage = "AI_PRECHECK" | "HUMAN_REVIEW" | "FINAL_REVIEW";

export type AIPrecheckDecision = "PASS" | "RETURN" | "NEED_HUMAN_REVIEW";

export type HumanReviewDecision = "PASS" | "RETURN" | "REJECT";

export type ReviewDecision = AIPrecheckDecision | HumanReviewDecision;

export type HumanReviewStage = "HUMAN_REVIEW" | "FINAL_REVIEW";

export interface ReviewPatch {
  fieldName: string;
  previousValue: unknown;
  nextValue: unknown;
  reason: string;
}

export interface BaseReviewCommand {
  submissionId: ID;
  stage: HumanReviewStage;
  comments?: ReviewComment[];
  patches?: ReviewPatch[];
}

export interface ReviewPassCommand extends BaseReviewCommand {
  decision: "PASS";
  reason?: string;
}

export interface ReviewReturnCommand extends BaseReviewCommand {
  decision: "RETURN";
  reason: string;
}

export interface ReviewRejectCommand extends BaseReviewCommand {
  decision: "REJECT";
  reason: string;
}

export type ReviewCommand =
  | ReviewPassCommand
  | ReviewReturnCommand
  | ReviewRejectCommand;

export interface BaseReviewResultRecord {
  id: ID;
  submissionId: ID;
  schemaVersionId: ID;
  actor: Actor;
  comments?: ReviewComment[];
  createdAt: ISODateTime;
}

export interface AIReviewResultRecord extends BaseReviewResultRecord {
  stage: "AI_PRECHECK";
  decision: AIPrecheckDecision;
  aiResult: AIReviewResult;
  patches?: never;
}

export interface HumanReviewResultRecord extends BaseReviewResultRecord {
  stage: "HUMAN_REVIEW";
  decision: HumanReviewDecision;
  patches?: ReviewPatch[];
  aiResult?: never;
}

export interface FinalReviewResultRecord extends BaseReviewResultRecord {
  stage: "FINAL_REVIEW";
  decision: HumanReviewDecision;
  patches?: ReviewPatch[];
  aiResult?: never;
}

export type ReviewResult =
  | AIReviewResultRecord
  | HumanReviewResultRecord
  | FinalReviewResultRecord;

export interface ReviewComment {
  fieldName?: string;
  message: string;
  severity?: "INFO" | "WARNING" | "BLOCKER";
}

export type AIReviewJobStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "RETRYING"
  | "FAILED_TO_HUMAN_REVIEW";

export interface PromptSnapshot {
  id: ID;
  template: string;
  renderedPromptRef?: ID;
  promptHash: string;
  variablesHash: string;
  createdAt: ISODateTime;
}

export interface ModelSnapshot {
  provider: string;
  model: string;
  temperature?: number;
  responseFormat: "JSON_SCHEMA" | "FUNCTION_CALLING";
}

export interface ReviewConfig {
  id: ID;
  taskId: ID;
  enabled: boolean;
  modelPolicyId: string;
  promptTemplate: string;
  dimensions: ReviewDimension[];
  thresholds: {
    passScore: number;
    returnScore: number;
  };
  conclusionMapping: {
    passWhen: Expression;
    returnWhen: Expression;
    humanReviewOtherwise: boolean;
  };
  maxRetries: number;
}

export interface ReviewDimension {
  key: string;
  label: string;
  description: string;
  weight: number;
  scoreRange: [number, number];
}

export interface AIReviewJob {
  id: ID;
  submissionId: ID;
  attemptNo: number;
  schemaVersionId: ID;
  status: AIReviewJobStatus;
  retryCount: number;
  maxRetries: number;
  idempotencyKey: string;
  promptSnapshotHash: string;
  promptSnapshotRef?: ID;
  modelSnapshot: ModelSnapshot;
  rawOutputRef?: ID;
  failureReason?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface AIReviewJobPayload {
  jobId: ID;
  task: Pick<Task, "id" | "title" | "description">;
  schemaVersionId: ID;
  schemaSnapshot: PublishedLabelHubSchema;
  item: DatasetItem;
  submission: Submission;
  reviewConfig: ReviewConfig;
  promptSnapshot: PromptSnapshot;
  modelSnapshot: ModelSnapshot;
}

export interface AIReviewResult {
  decision: AIPrecheckDecision;
  totalScore: number;
  dimensionScores: Array<{
    key: string;
    score: number;
    reason: string;
  }>;
  fieldIssues: Array<{
    fieldName?: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    message: string;
    suggestion?: string;
  }>;
  summary: string;
  confidence: number;
}

export type LLMCallStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface LLMCallLog {
  id: ID;
  purpose: "LLM_ASSIST" | "AI_REVIEW" | "SCHEMA_GENERATION";
  actorId: ID;
  assignmentId?: ID;
  submissionId?: ID;
  nodeId?: string;
  modelPolicyId: string;
  promptSnapshotHash: string;
  inputHash: string;
  outputHash?: string;
  status: LLMCallStatus;
  errorMessage?: string;
  createdAt: ISODateTime;
  finishedAt?: ISODateTime;
}
