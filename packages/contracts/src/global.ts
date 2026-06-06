import type { AIReviewResult, ReviewComment, ReviewDecision, ReviewPatch } from "./review";
import type { AnswerPayload, TaskStatus } from "./workflow";

export type ID =
  | `usr_${string}`
  | `task_${string}`
  | `schema_${string}`
  | `sv_${string}`
  | `item_${string}`
  | `asn_${string}`
  | `sub_${string}`
  | `rev_${string}`
  | `job_${string}`
  | `file_${string}`
  | `audit_${string}`
  | `cfg_${string}`
  | `prompt_${string}`
  | `llm_${string}`;

export type ISODateTime = string;

export type Role = "OWNER" | "LABELER" | "REVIEWER" | "SYSTEM" | "ADMIN";

export interface Actor {
  id: ID;
  role: Role;
  displayName: string;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type ContractVersion = "1.1";

export interface SchemaVersionRef {
  schemaId: ID;
  schemaVersionId: ID;
  schemaVersionNo: number;
}

export type JsonPath = string;

export type SchemaVisibilityMode =
  | "CREATE"
  | "EDIT"
  | "REVIEW"
  | "READONLY"
  | "HISTORICAL";

export interface LabelHubRuntimeContext {
  task: TaskRuntimeContext;
  schema: SchemaRuntimeContext;
  item: DatasetItemRuntimeContext;
  answers: AnswerPayload;
  review?: ReviewRuntimeContext;
  system: SystemRuntimeContext;
  meta?: Record<string, unknown>;
}

export interface RuntimeContextWithOutput extends LabelHubRuntimeContext {
  output?: unknown;
  visibilityMode?: SchemaVisibilityMode;
}

export interface TaskRuntimeContext {
  id: ID;
  title: string;
  status: TaskStatus;
  activeSchemaVersionId: ID;
}

export interface SchemaRuntimeContext {
  schemaId: ID;
  schemaVersionId: ID;
  schemaVersionNo: number;
  contractVersion: ContractVersion;
}

export interface DatasetItemRuntimeContext {
  id: ID;
  externalKey?: string;
  sourcePayload: Record<string, unknown>;
}

export interface ReviewRuntimeContext {
  latestDecision?: ReviewDecision;
  aiResult?: AIReviewResult;
  comments?: ReviewComment[];
  patches?: ReviewPatch[];
}

export interface SystemRuntimeContext {
  actor: Actor;
  role: Role;
  now: ISODateTime;
  timezone?: string;
}
