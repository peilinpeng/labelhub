import type { AuditAction } from "../audit";
import type { ErrorCode } from "../errors";
import type { ExportColumn, ExportFormat, ExportMapping } from "../export";
import type { FileObject, FileRef, FileStatus } from "../file";
import type { LabelHubRuntimeContext, JsonPath } from "../global";
import type { AIReviewResultRecord, LLMCallLog, ReviewCommand, ReviewPolicy } from "../review";
import type {
  BaseFieldNode,
  Expression,
  ExprValue,
  FieldNode,
  LabelHubSchema,
  SchemaNode,
  ValidationError,
} from "../schema";
import type { AnswerPayload, DatasetItemStatus, Submission, SubmissionStatus, TaskStatus } from "../workflow";

export interface ContractViolation {
  code: ErrorCode;
  message: string;
  nodeId?: string | undefined;
  fieldName?: string | undefined;
}

export interface NormalizeAnswersResult {
  answers: AnswerPayload;
  errors: ValidationError[];
}

const allowedNodeTypes = new Set<string>([
  "input.text",
  "input.textarea",
  "input.richtext",
  "choice.radio",
  "choice.checkbox",
  "choice.select",
  "choice.tags",
  "upload.file",
  "upload.image",
  "data.json",
  "show.text",
  "show.richtext",
  "show.image",
  "show.file",
  "show.json",
  "container.group",
  "container.tabs",
  "container.section",
  "llm.assist",
]);

const answerFieldTypes = new Set<string>([
  "input.text",
  "input.textarea",
  "input.richtext",
  "choice.radio",
  "choice.checkbox",
  "choice.select",
  "choice.tags",
  "upload.file",
  "upload.image",
  "data.json",
]);

export function validateSchemaInvariants(schema: unknown): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const ids = new Set<string>();
  const fieldNames = new Set<string>();
  const nodes = collectUnknownNodes(schema);

  for (const node of nodes) {
    const nodeId = readString(node, "id");
    const nodeType = readString(node, "type");
    const kind = readString(node, "kind");

    if (nodeId !== undefined) {
      if (ids.has(nodeId)) {
        violations.push({ code: "NODE_ID_DUPLICATED", message: "node.id 必须全局唯一", nodeId });
      }
      ids.add(nodeId);
    }

    if (nodeType === undefined || !allowedNodeTypes.has(nodeType)) {
      violations.push({
        code: "UNKNOWN_NODE_TYPE",
        message: "node.type 必须来自 server registry 支持的 NodeType",
        nodeId,
      });
    }

    if (kind === "FIELD") {
      const fieldName = readString(node, "name");
      if (nodeType !== undefined && !answerFieldTypes.has(nodeType)) {
        violations.push({ code: "SCHEMA_INVALID", message: "FieldNode.type 必须是 AnswerFieldType", nodeId });
      }
      if (fieldName !== undefined) {
        if (fieldNames.has(fieldName)) {
          violations.push({
            code: "FIELD_NAME_DUPLICATED",
            message: "FieldNode.name 必须在 schema version 内唯一",
            nodeId,
            fieldName,
          });
        }
        fieldNames.add(fieldName);
      }
    }
  }

  return violations;
}

export function assertAIGeneratedSchemaDraft(schema: LabelHubSchema): ContractViolation[] {
  const violations: ContractViolation[] = [];
  if (schema.status !== "DRAFT") {
    violations.push({ code: "SCHEMA_INVALID", message: "AI-generated schema 只能是 DRAFT" });
  }
  if (schema.schemaVersionId !== undefined) {
    violations.push({ code: "SCHEMA_INVALID", message: "AI-generated schema 不得包含 schemaVersionId" });
  }
  return violations;
}

export function assertPublishedSchemaImmutable(
  previous: LabelHubSchema,
  next: LabelHubSchema,
): ContractViolation[] {
  if (previous.status !== "PUBLISHED") {
    return [];
  }
  return stableStringify(previous) === stableStringify(next)
    ? []
    : [{ code: "SCHEMA_VERSION_IMMUTABLE", message: "Published schema version 一旦发布不可变" }];
}

export function collectSchemaNodes(schema: LabelHubSchema): SchemaNode[] {
  const nodes: SchemaNode[] = [];
  walkSchemaNode(schema.root, (node) => nodes.push(node));
  return nodes;
}

export function isAnswerFieldNode(node: SchemaNode): node is FieldNode {
  return node.kind === "FIELD";
}

export function isAllowedRuntimeJsonPath(path: JsonPath, options?: { allowOutput?: boolean }): boolean {
  if (path.startsWith("$.task.")) return true;
  if (path.startsWith("$.schema.")) return true;
  if (path.startsWith("$.item.sourcePayload.")) return true;
  if (path === "$.item.id" || path === "$.item.externalKey") return true;
  if (path.startsWith("$.answers.")) return true;
  if (path.startsWith("$.review.")) return true;
  if (path.startsWith("$.system.")) return true;
  if (path.startsWith("$.meta.")) return true;
  if (options?.allowOutput === true && path.startsWith("$.output.")) return true;
  return false;
}

export function evaluateExpression(expression: Expression, context: LabelHubRuntimeContext): boolean {
  switch (expression.op) {
    case "eq":
      return resolveExprValue(expression.left, context) === resolveExprValue(expression.right, context);
    case "ne":
      return resolveExprValue(expression.left, context) !== resolveExprValue(expression.right, context);
    case "gt":
      return compareValues(expression.left, expression.right, context, (left, right) => left > right);
    case "gte":
      return compareValues(expression.left, expression.right, context, (left, right) => left >= right);
    case "lt":
      return compareValues(expression.left, expression.right, context, (left, right) => left < right);
    case "lte":
      return compareValues(expression.left, expression.right, context, (left, right) => left <= right);
    case "in":
      return isInList(resolveExprValue(expression.left, context), expression.right.map((item) => resolveExprValue(item, context)));
    case "notIn":
      return !isInList(resolveExprValue(expression.left, context), expression.right.map((item) => resolveExprValue(item, context)));
    case "empty":
      return isEmptyValue(resolveExprValue(expression.value, context));
    case "notEmpty":
      return !isEmptyValue(resolveExprValue(expression.value, context));
    case "and":
      return expression.items.every((item) => evaluateExpression(item, context));
    case "or":
      return expression.items.some((item) => evaluateExpression(item, context));
    case "not":
      return !evaluateExpression(expression.item, context);
  }
}

export function normalizeAnswers(
  schema: LabelHubSchema,
  answers: AnswerPayload,
  context: LabelHubRuntimeContext,
): NormalizeAnswersResult {
  const result: AnswerPayload = {};
  const errors: ValidationError[] = [];

  for (const node of collectSchemaNodes(schema)) {
    if (!isAnswerFieldNode(node)) {
      continue;
    }

    const hasValue = Object.prototype.hasOwnProperty.call(answers, node.name);
    const value = answers[node.name];
    const visible = isFieldVisible(node, context);
    const shouldSubmit = visible || (node.preserveWhenHidden === true && hasValue);

    if (!shouldSubmit || !hasValue) {
      continue;
    }

    if (!isValueAcceptedByField(node, value)) {
      errors.push({
        fieldName: node.name,
        nodeId: node.id,
        code: "VALIDATION_FAILED",
        message: "answers 中的字段值不符合 FieldNode.type",
        severity: "ERROR",
      });
      continue;
    }

    result[node.name] = value;
  }

  return { answers: result, errors };
}

export function validateRequiredFields(
  schema: LabelHubSchema,
  answers: AnswerPayload,
  context: LabelHubRuntimeContext,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const node of collectSchemaNodes(schema)) {
    if (!isAnswerFieldNode(node)) {
      continue;
    }
    const visible = isFieldVisible(node, context);
    const shouldValidate = visible || node.validateWhenHidden === true;
    if (!shouldValidate || !isRequiredField(node)) {
      continue;
    }
    if (isEmptyValue(answers[node.name])) {
      errors.push({
        fieldName: node.name,
        nodeId: node.id,
        code: "VALIDATION_FAILED",
        message: "必填字段不能为空",
        severity: "ERROR",
      });
    }
  }

  return errors;
}

export function transitionTaskStatus(status: TaskStatus, command: "publishTask" | "pauseTask" | "resumeTask" | "endTask"):
  | { ok: true; status: TaskStatus }
  | { ok: false; code: ErrorCode } {
  const transitions: Record<string, TaskStatus> = {
    "DRAFT:publishTask": "PUBLISHED",
    "PUBLISHED:pauseTask": "PAUSED",
    "PAUSED:resumeTask": "PUBLISHED",
    "PUBLISHED:endTask": "ENDED",
    "PAUSED:endTask": "ENDED",
  };
  const next = transitions[`${status}:${command}`];
  return next === undefined ? { ok: false, code: "INVALID_STATE_TRANSITION" } : { ok: true, status: next };
}

export function transitionSubmissionStatus(
  status: SubmissionStatus,
  command:
    | "enqueueAIReview"
    | "aiReviewPass"
    | "aiReviewNeedHuman"
    | "aiReviewFailedToHuman"
    | "claimReview"
    | "humanReviewPass"
    | "humanReviewReturn",
): { ok: true; status: SubmissionStatus } | { ok: false; code: ErrorCode } {
  const transitions: Record<string, SubmissionStatus> = {
    "SUBMITTED:enqueueAIReview": "AI_REVIEWING",
    "AI_REVIEWING:aiReviewPass": "AI_PASSED",
    "AI_REVIEWING:aiReviewNeedHuman": "NEEDS_HUMAN_REVIEW",
    "AI_REVIEWING:aiReviewFailedToHuman": "NEEDS_HUMAN_REVIEW",
    "AI_PASSED:claimReview": "HUMAN_REVIEWING",
    "NEEDS_HUMAN_REVIEW:claimReview": "HUMAN_REVIEWING",
    "HUMAN_REVIEWING:humanReviewPass": "ACCEPTED",
    "HUMAN_REVIEWING:humanReviewReturn": "RETURNED",
  };
  const next = transitions[`${status}:${command}`];
  return next === undefined ? { ok: false, code: "INVALID_STATE_TRANSITION" } : { ok: true, status: next };
}

export function validateReviewCommand(command: ReviewCommand | { decision?: unknown; reason?: unknown }): ErrorCode[] {
  const errors: ErrorCode[] = [];
  if ((command.decision === "RETURN" || command.decision === "REJECT") && typeof command.reason !== "string") {
    errors.push("REVIEW_REASON_REQUIRED");
  }
  if (command.decision === "NEED_HUMAN_REVIEW") {
    errors.push("INVALID_STATE_TRANSITION");
  }
  return errors;
}

export function retryExhaustedTargetStatus(retryCount: number, maxRetries: number): SubmissionStatus | undefined {
  return retryCount >= maxRetries ? "NEEDS_HUMAN_REVIEW" : undefined;
}

export function canEnterExportPool(submission: Pick<Submission, "status">): boolean {
  return submission.status === "ACCEPTED";
}

export function validateAIReviewResultShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.decision === "string" &&
    typeof value.totalScore === "number" &&
    Array.isArray(value.dimensionScores) &&
    Array.isArray(value.fieldIssues) &&
    typeof value.summary === "string" &&
    typeof value.confidence === "number"
  );
}

export function aiReviewHasPatches(record: AIReviewResultRecord): boolean {
  return "patches" in record && record.patches !== undefined;
}

export function isSchemaGenerationLLMCall(log: Pick<LLMCallLog, "purpose">): boolean {
  return log.purpose === "SCHEMA_GENERATION";
}

export function isExportColumnPathValid(column: Pick<ExportColumn, "sourcePath">): boolean {
  return isAllowedRuntimeJsonPath(column.sourcePath);
}

export function isTabularObjectValueTransformValid(
  format: ExportFormat,
  value: unknown,
  column: Pick<ExportColumn, "transform">,
): boolean {
  const isTabular = format === "CSV" || format === "EXCEL";
  const needsTransform = isTabular && typeof value === "object" && value !== null;
  return !needsTransform || column.transform !== undefined;
}

export function isDefaultExportEligible(submission: Pick<Submission, "status">): boolean {
  return submission.status === "ACCEPTED";
}

export function usesPatchedAnswersExplicitly(
  mapping: Pick<ExportMapping, "answerSource" | "allowPatchedAnswers">,
): boolean {
  return mapping.answerSource === "PATCHED_ANSWERS" && mapping.allowPatchedAnswers === true;
}

export function isExportAnswerSourceAllowed(
  mapping: Pick<ExportMapping, "answerSource" | "allowPatchedAnswers">,
): boolean {
  return mapping.answerSource !== "PATCHED_ANSWERS" || mapping.allowPatchedAnswers === true;
}

export function reviewPassAuditActionForPolicy(policy: ReviewPolicy): AuditAction {
  return policy.type === "DOUBLE_REVIEW" ? "FINAL_REVIEW_REQUESTED" : "REVIEW_ACCEPTED";
}

export function reviewRejectDatasetItemStatus(): DatasetItemStatus {
  return "AVAILABLE";
}

export function isCreateUploadUrlResult(file: Pick<FileObject, "status">): boolean {
  return file.status === "PENDING";
}

export function canMarkUploadStarted(status: FileStatus): boolean {
  return status === "PENDING";
}

export function canConfirmUpload(status: FileStatus): boolean {
  return status === "PENDING" || status === "UPLOADING";
}

export function fileUploadTransitionAuditAction(command: "createUploadUrl" | "markUploadStarted" | "confirmUpload"): AuditAction {
  switch (command) {
    case "createUploadUrl":
      return "FILE_UPLOAD_URL_CREATED";
    case "markUploadStarted":
      return "FILE_UPLOAD_STARTED";
    case "confirmUpload":
      return "FILE_CONFIRMED";
  }
}

export function canUseUploadFileRef(
  fileRef: FileRef,
  file: FileObject,
  currentAssignmentId: string,
  currentUserId: string,
): boolean {
  if (fileRef.fileId !== file.id) return false;
  if (file.ownerType === "ASSIGNMENT" && file.ownerId === currentAssignmentId) return true;
  if (file.ownerType === "USER" && file.ownerId === currentUserId) return true;
  return false;
}

export function canUseDatasetImportFile(file: FileObject): boolean {
  return file.status === "READY" && file.purpose === "DATASET_IMPORT";
}

export function canDownloadExportFile(file: FileObject): boolean {
  return file.status === "READY" && file.purpose === "EXPORT_RESULT";
}

function walkSchemaNode(node: SchemaNode, visit: (node: SchemaNode) => void): void {
  visit(node);
  if (node.kind === "CONTAINER") {
    for (const child of node.children) {
      walkSchemaNode(child, visit);
    }
  }
}

function collectUnknownNodes(schema: unknown): unknown[] {
  if (!isRecord(schema)) return [];
  const root = schema.root;
  const nodes: unknown[] = [];
  walkUnknownNode(root, nodes);
  return nodes;
}

function walkUnknownNode(node: unknown, nodes: unknown[]): void {
  if (!isRecord(node)) return;
  nodes.push(node);
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      walkUnknownNode(child, nodes);
    }
  }
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === "string" ? item : undefined;
}

function isFieldVisible(field: BaseFieldNode, context: LabelHubRuntimeContext): boolean {
  if (field.hidden === true) return false;
  if (field.visibleWhen !== undefined) return evaluateExpression(field.visibleWhen, context);
  return true;
}

function isRequiredField(field: BaseFieldNode): boolean {
  if (field.required === true) return true;
  return field.validations?.some((rule) => rule.type === "required") === true;
}

function isValueAcceptedByField(field: FieldNode, value: unknown): boolean {
  switch (field.type) {
    case "choice.radio":
      return typeof value === "string";
    case "choice.checkbox":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "data.json":
      return isJsonSerializable(value);
    default:
      return true;
  }
}

function isJsonSerializable(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function resolveExprValue(value: ExprValue, context: LabelHubRuntimeContext): unknown {
  if (value.kind === "literal") {
    return value.value;
  }
  return getPathValue(context, value.path);
}

function getPathValue(source: unknown, path: JsonPath): unknown {
  if (!path.startsWith("$.")) return undefined;
  const segments = path
    .slice(2)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((segment) => segment.length > 0);
  let current = source;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function compareValues(
  left: ExprValue,
  right: ExprValue,
  context: LabelHubRuntimeContext,
  compare: (left: number, right: number) => boolean,
): boolean {
  const leftValue = resolveExprValue(left, context);
  const rightValue = resolveExprValue(right, context);
  return typeof leftValue === "number" && typeof rightValue === "number" && compare(leftValue, rightValue);
}

function isInList(left: unknown, right: unknown[]): boolean {
  if (Array.isArray(left)) {
    return left.some((item) => right.includes(item));
  }
  return right.includes(left);
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!isRecord(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortObject(value[key]);
      return acc;
    }, {});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
