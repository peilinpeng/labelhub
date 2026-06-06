import type { AiAssistType, AuditLogSummary } from "./audit";
import type { ID, ISODateTime, ContractVersion, JsonPath, ReviewRuntimeContext } from "./global";
import type { FileRef } from "./file";
import type { ServerComponentRegistryItem, FrontendComponentRegistryItem } from "./registry";
import type { SubmitAssignmentResponse } from "./api";
import type { AnswerPayload, Draft, DatasetItem } from "./workflow";
import type { ErrorCode } from "./errors";

export type SchemaStatus = "DRAFT" | "PUBLISHED" | "DEPRECATED";

export interface LabelHubSchema {
  contractVersion: ContractVersion;
  schemaId: ID;
  schemaVersionId?: ID;
  schemaVersionNo?: number;
  schemaDraftRevision?: number;
  status: SchemaStatus;
  meta: SchemaMeta;
  root: ContainerNode;
  definitions?: Record<string, unknown>;
}

export interface SchemaMeta {
  name: string;
  description?: string;
  taskId: ID;
  authorId: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  publishedAt?: ISODateTime;
  deprecatedAt?: ISODateTime;
}

export interface SchemaVersion {
  id: ID;
  schemaId: ID;
  taskId: ID;
  schemaVersionNo: number;
  previousVersionId?: ID;
  snapshotHash?: string;
  contractVersion: ContractVersion;
  snapshot: PublishedLabelHubSchema;
  createdAt: ISODateTime;
}

export interface PublishedLabelHubSchema extends LabelHubSchema {
  schemaVersionId: ID;
  schemaVersionNo: number;
  status: "PUBLISHED";
}

export type SchemaNode = FieldNode | ContainerNode | ShowItemNode | LLMAssistNode;

export type NodeType =
  | InputFieldType
  | ChoiceFieldType
  | UploadFieldType
  | DataFieldType
  | ShowItemType
  | ContainerType
  | "llm.assist";

export type InputFieldType = "input.text" | "input.textarea" | "input.richtext";

export type ChoiceFieldType = "choice.radio" | "choice.checkbox" | "choice.select" | "choice.tags";

export type UploadFieldType = "upload.file" | "upload.image";

export type DataFieldType = "data.json";

export type ShowItemType =
  | "show.text"
  | "show.richtext"
  | "show.image"
  | "show.file"
  | "show.json";

export type ContainerType = "container.group" | "container.tabs" | "container.section";

export type AnswerFieldType =
  | InputFieldType
  | ChoiceFieldType
  | UploadFieldType
  | DataFieldType;

export interface BaseNode {
  id: string;
  type: NodeType;
  title: string;
  description?: string;
  hidden?: boolean;
  disabled?: boolean;
  visibleWhen?: Expression;
  disabledWhen?: Expression;
  ui?: UIOptions;
  analyticsKey?: string;
}

export interface BaseFieldNode extends BaseNode {
  kind: "FIELD";
  type: AnswerFieldType;
  name: string;
  defaultValue?: unknown;
  required?: boolean;
  preserveWhenHidden?: boolean;
  validateWhenHidden?: boolean;
  submitWhenDisabled?: boolean;
  validations?: ValidationRule[];
  deprecation?: FieldDeprecationConfig;
}

export interface TextFieldNode extends BaseFieldNode {
  type: "input.text" | "input.textarea";
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
}

export interface RichTextFieldNode extends BaseFieldNode {
  type: "input.richtext";
  placeholder?: string;
  toolbarPreset?: "BASIC" | "FULL";
}

export interface ChoiceFieldNode extends BaseFieldNode {
  type: ChoiceFieldType;
  options: Option[];
  multiple?: boolean;
  allowCustom?: boolean;
}

export interface UploadFieldNode extends BaseFieldNode {
  type: UploadFieldType;
  accept?: string[];
  maxSizeMB?: number;
  maxCount?: number;
}

export interface JsonFieldNode extends BaseFieldNode {
  type: "data.json";
  jsonSchema?: JsonSchemaLike;
  editorMode?: "TREE" | "CODE";
}

export type FieldNode =
  | TextFieldNode
  | RichTextFieldNode
  | ChoiceFieldNode
  | UploadFieldNode
  | JsonFieldNode;

export interface FieldDeprecationConfig {
  deprecated: boolean;
  reason?: string;
  replacementFieldName?: string;
  hideForNewSubmissions?: boolean;
  readonlyForNewSubmissions?: boolean;
  plannedRemovalSchemaVersionNo?: number;
}

export interface ShowItemNode extends BaseNode {
  kind: "SHOW_ITEM";
  type: ShowItemType;
  sourcePath: JsonPath;
  transform?: TransformSpec;
}

export interface LLMAssistNode extends BaseNode {
  kind: "LLM_ASSIST";
  type: "llm.assist";
  trigger: "MANUAL" | "ON_FIELD_CHANGE";
  promptTemplateId?: ID;
  promptTemplate?: string;
  modelPolicyId?: string;
  inputBindings: Record<string, JsonPath>;
  outputMode: "SUGGESTION" | "PREFILL" | "STRUCTURED";
  outputSchema?: JsonSchemaLike;
  outputBindings?: LLMOutputBinding[];
  rateLimit?: {
    maxCallsPerAssignment: number;
  };
}

export interface ContainerNode extends BaseNode {
  kind: "CONTAINER";
  type: ContainerType;
  name?: string;
  children: SchemaNode[];
  layout?: LayoutSpec;
}

export interface Option {
  label: string;
  value: string;
  disabled?: boolean;
  color?: string;
}

export interface RichTextDocument {
  type: "doc";
  content: unknown[];
}

export type JsonSchemaLike = Record<string, unknown>;

export interface UIOptions {
  width?: "FULL" | "HALF" | "THIRD";
  order?: number;
  helpText?: string;
  tooltip?: string;
  labelPosition?: "TOP" | "LEFT";
  readonlyInReview?: boolean;
  extra?: Record<string, unknown>;
}

export interface LayoutSpec {
  columns?: 1 | 2 | 3 | 4;
  gap?: number;
  tabStyle?: "LINE" | "CARD";
}

export type TransformSpec =
  | { type: "TEXT"; fallback?: string }
  | { type: "MARKDOWN" }
  | { type: "JSON_STRINGIFY"; space?: number }
  | { type: "DATE"; format?: string }
  | { type: "FILE_URLS" }
  | { type: "IMAGE_PREVIEW" };

export type Expression =
  | { op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; left: ExprValue; right: ExprValue }
  | { op: "in" | "notIn"; left: ExprValue; right: ExprValue[] }
  | { op: "empty" | "notEmpty"; value: ExprValue }
  | { op: "and" | "or"; items: Expression[] }
  | { op: "not"; item: Expression };

export type ExprValue =
  | { kind: "path"; path: JsonPath }
  | { kind: "literal"; value: unknown };

export interface LLMOutputBinding {
  from: JsonPath;
  toFieldName: string;
  mode: "REPLACE" | "APPEND" | "MERGE";
  requireUserConfirm: boolean;
}

export interface LLMRuntimeRequest {
  nodeId: string;
  answers: AnswerPayload;
}

export interface LLMRuntimeResponse {
  output: unknown;
  suggestedPatch?: AnswerPayload;
  callId: ID;
  promptVersionId?: string;
  modelId?: string;
  assistType?: AiAssistType;
  latencyMs?: number;
  /**
   * 应由后端或统一 hash 工具基于 canonical-json-v1 + SHA-256 生成。
   * 前端不应使用 stableStringify 字符串冒充 hash。
   */
  outputHash?: string;
  /**
   * 应由后端或统一 hash 工具基于 canonical-json-v1 + SHA-256 生成。
   * 前端不应使用 stableStringify 字符串冒充 hash。
   */
  promptSnapshotHash?: string;
}

export type ValidationRuleType =
  | "required"
  | "minLength"
  | "maxLength"
  | "regex"
  | "minItems"
  | "maxItems"
  | "jsonSchema"
  | "file"
  | "custom"
  | "conditional";

export type ValidationRule =
  | { type: "required"; message?: string }
  | { type: "minLength"; value: number; message?: string }
  | { type: "maxLength"; value: number; message?: string }
  | { type: "regex"; pattern: string; flags?: string; message?: string }
  | { type: "minItems"; value: number; message?: string }
  | { type: "maxItems"; value: number; message?: string }
  | { type: "jsonSchema"; schema: JsonSchemaLike; message?: string }
  | { type: "file"; accept?: string[]; maxSizeMB?: number; maxCount?: number; message?: string }
  | { type: "custom"; ruleId: string; params?: Record<string, unknown>; message?: string }
  | { type: "conditional"; when: Expression; rules: ValidationRule[]; message?: string };

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationError[];
}

export interface ValidationError {
  fieldName?: string;
  nodeId?: string;
  code: ErrorCode;
  message: string;
  severity: "ERROR" | "WARNING";
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationError[];
  warnings: SchemaValidationError[];
}

export interface SchemaValidationError {
  nodeId?: string;
  path: string;
  code: ErrorCode;
  message: string;
}

export interface DesignerProps {
  schema: LabelHubSchema;
  serverRegistry: ServerComponentRegistryItem[];
  frontendRegistry: FrontendComponentRegistryItem[];
  readonly?: boolean;
  previewItem?: DatasetItem;
  onChange(nextSchema: LabelHubSchema): void;
  onValidate(schema: LabelHubSchema): Promise<SchemaValidationResult>;
  onPublishSchema(taskId: ID, schemaDraftRevision: number): Promise<SchemaVersion>;
}

export interface DesignerOperations {
  addNode(parentId: string, node: SchemaNode, index?: number): void;
  updateNode(nodeId: string, patch: Partial<SchemaNode>): void;
  moveNode(nodeId: string, targetParentId: string, index: number): void;
  duplicateNode(nodeId: string): void;
  removeNode(nodeId: string): void;
}

export type RendererMode = "LABELING" | "REVIEW_READONLY" | "REVIEW_DIFF" | "PREVIEW";

export interface RendererProps {
  schema: PublishedLabelHubSchema;
  item: DatasetItem;
  mode: RendererMode;
  value: AnswerPayload;
  errors?: ValidationError[];
  reviewContext?: ReviewRuntimeContext;
  onChange(nextValue: AnswerPayload, change: AnswerChange): void;
  onAutoSave?(value: AnswerPayload): Promise<Draft>;
  onSubmit?(value: AnswerPayload): Promise<SubmitAssignmentResponse>;
  onLLMCall?(request: LLMRuntimeRequest): Promise<LLMRuntimeResponse>;
  onFileUpload?(file: File): Promise<FileRef>;
}

export interface AnswerChange {
  fieldName: string;
  previousValue: unknown;
  nextValue: unknown;
  changedAt: ISODateTime;
}

export interface PublishSchemaVersionRequest {
  schemaDraftRevision: number;
}

export interface PublishSchemaVersionResponse {
  schemaVersion: SchemaVersion;
  auditLog: AuditLogSummary;
}
