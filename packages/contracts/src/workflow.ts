import type { ID, ISODateTime } from "./global";
import type { ReviewPolicy } from "./review";
import type { RichTextDocument, ValidationError, ValidationResult } from "./schema";

export type TaskStatus = "DRAFT" | "PUBLISHED" | "PAUSED" | "ENDED" | "ARCHIVED";

export interface Task {
  id: ID;
  title: string;
  description: string;
  instructionRichText?: RichTextDocument;
  tags: string[];
  rewardRule?: RewardRule;
  quota: {
    total: number;
    perLabeler?: number;
  };
  deadlineAt?: ISODateTime;
  distributionStrategy: DistributionStrategy;
  reviewPolicy: ReviewPolicy;
  status: TaskStatus;
  activeSchemaVersionId?: ID;
  ownerId: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type DistributionStrategy =
  | { type: "FIRST_COME_FIRST_SERVED" }
  | { type: "ASSIGNMENT"; assigneeIds: ID[] }
  | { type: "QUOTA_CLAIM"; claimBatchSize: number };

export interface RewardRule {
  unit: "PER_ACCEPTED_ITEM" | "PER_SUBMISSION" | "FIXED";
  amount: number;
  currency?: string;
}

export type DatasetItemStatus = "AVAILABLE" | "LOCKED" | "COMPLETED" | "DISABLED";

export interface DatasetItem {
  id: ID;
  taskId: ID;
  externalKey?: string;
  sourcePayload: Record<string, unknown>;
  status: DatasetItemStatus;
  currentAssignmentId?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type AssignmentStatus =
  | "CLAIMED"
  | "DRAFTING"
  | "SUBMITTED"
  | "RETURNED"
  | "ACCEPTED"
  | "CANCELED"
  | "EXPIRED";

export interface Assignment {
  id: ID;
  taskId: ID;
  itemId: ID;
  labelerId: ID;
  schemaVersionId: ID;
  status: AssignmentStatus;
  lockedUntil?: ISODateTime;
  latestSubmissionId?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Draft {
  assignmentId: ID;
  schemaVersionId: ID;
  answers: AnswerPayload;
  clientRevision: number;
  serverRevision: number;
  validationErrors?: ValidationError[];
  savedAt: ISODateTime;
}

export type SubmissionStatus =
  | "SUBMITTED"
  | "AI_REVIEWING"
  | "AI_PASSED"
  | "NEEDS_HUMAN_REVIEW"
  | "HUMAN_REVIEWING"
  | "FINAL_REVIEWING"
  | "RETURNED"
  | "ACCEPTED"
  | "REJECTED";

export interface Submission {
  id: ID;
  assignmentId: ID;
  taskId: ID;
  itemId: ID;
  labelerId: ID;
  schemaVersionId: ID;
  attemptNo: number;
  answers: AnswerPayload;
  status: SubmissionStatus;
  validationSnapshot: ValidationResult;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type AnswerPayload = Record<string, unknown>;
