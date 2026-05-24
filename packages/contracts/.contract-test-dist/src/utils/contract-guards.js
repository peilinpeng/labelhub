"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSchemaInvariants = validateSchemaInvariants;
exports.assertAIGeneratedSchemaDraft = assertAIGeneratedSchemaDraft;
exports.assertPublishedSchemaImmutable = assertPublishedSchemaImmutable;
exports.collectSchemaNodes = collectSchemaNodes;
exports.isAnswerFieldNode = isAnswerFieldNode;
exports.isAllowedRuntimeJsonPath = isAllowedRuntimeJsonPath;
exports.evaluateExpression = evaluateExpression;
exports.normalizeAnswers = normalizeAnswers;
exports.validateRequiredFields = validateRequiredFields;
exports.transitionTaskStatus = transitionTaskStatus;
exports.transitionSubmissionStatus = transitionSubmissionStatus;
exports.validateReviewCommand = validateReviewCommand;
exports.retryExhaustedTargetStatus = retryExhaustedTargetStatus;
exports.canEnterExportPool = canEnterExportPool;
exports.validateAIReviewResultShape = validateAIReviewResultShape;
exports.aiReviewHasPatches = aiReviewHasPatches;
exports.isSchemaGenerationLLMCall = isSchemaGenerationLLMCall;
exports.isExportColumnPathValid = isExportColumnPathValid;
exports.isTabularObjectValueTransformValid = isTabularObjectValueTransformValid;
exports.isDefaultExportEligible = isDefaultExportEligible;
exports.usesPatchedAnswersExplicitly = usesPatchedAnswersExplicitly;
exports.canUseUploadFileRef = canUseUploadFileRef;
exports.canUseDatasetImportFile = canUseDatasetImportFile;
exports.canDownloadExportFile = canDownloadExportFile;
const allowedNodeTypes = new Set([
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
const answerFieldTypes = new Set([
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
function validateSchemaInvariants(schema) {
    const violations = [];
    const ids = new Set();
    const fieldNames = new Set();
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
function assertAIGeneratedSchemaDraft(schema) {
    const violations = [];
    if (schema.status !== "DRAFT") {
        violations.push({ code: "SCHEMA_INVALID", message: "AI-generated schema 只能是 DRAFT" });
    }
    if (schema.schemaVersionId !== undefined) {
        violations.push({ code: "SCHEMA_INVALID", message: "AI-generated schema 不得包含 schemaVersionId" });
    }
    return violations;
}
function assertPublishedSchemaImmutable(previous, next) {
    if (previous.status !== "PUBLISHED") {
        return [];
    }
    return stableStringify(previous) === stableStringify(next)
        ? []
        : [{ code: "SCHEMA_VERSION_IMMUTABLE", message: "Published schema version 一旦发布不可变" }];
}
function collectSchemaNodes(schema) {
    const nodes = [];
    walkSchemaNode(schema.root, (node) => nodes.push(node));
    return nodes;
}
function isAnswerFieldNode(node) {
    return node.kind === "FIELD";
}
function isAllowedRuntimeJsonPath(path, options) {
    if (path.startsWith("$.task."))
        return true;
    if (path.startsWith("$.schema."))
        return true;
    if (path.startsWith("$.item.sourcePayload."))
        return true;
    if (path === "$.item.id" || path === "$.item.externalKey")
        return true;
    if (path.startsWith("$.answers."))
        return true;
    if (path.startsWith("$.review."))
        return true;
    if (path.startsWith("$.system."))
        return true;
    if (path.startsWith("$.meta."))
        return true;
    if (options?.allowOutput === true && path.startsWith("$.output."))
        return true;
    return false;
}
function evaluateExpression(expression, context) {
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
function normalizeAnswers(schema, answers, context) {
    const result = {};
    const errors = [];
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
function validateRequiredFields(schema, answers, context) {
    const errors = [];
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
function transitionTaskStatus(status, command) {
    const transitions = {
        "DRAFT:publishTask": "PUBLISHED",
        "PUBLISHED:pauseTask": "PAUSED",
        "PAUSED:resumeTask": "PUBLISHED",
        "PUBLISHED:endTask": "ENDED",
        "PAUSED:endTask": "ENDED",
    };
    const next = transitions[`${status}:${command}`];
    return next === undefined ? { ok: false, code: "INVALID_STATE_TRANSITION" } : { ok: true, status: next };
}
function transitionSubmissionStatus(status, command) {
    const transitions = {
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
function validateReviewCommand(command) {
    const errors = [];
    if (command.decision === "RETURN" && typeof command.reason !== "string") {
        errors.push("REVIEW_REASON_REQUIRED");
    }
    if (command.decision === "NEED_HUMAN_REVIEW") {
        errors.push("INVALID_STATE_TRANSITION");
    }
    return errors;
}
function retryExhaustedTargetStatus(retryCount, maxRetries) {
    return retryCount >= maxRetries ? "NEEDS_HUMAN_REVIEW" : undefined;
}
function canEnterExportPool(submission) {
    return submission.status === "ACCEPTED";
}
function validateAIReviewResultShape(value) {
    if (!isRecord(value))
        return false;
    return (typeof value.decision === "string" &&
        typeof value.totalScore === "number" &&
        Array.isArray(value.dimensionScores) &&
        Array.isArray(value.fieldIssues) &&
        typeof value.summary === "string" &&
        typeof value.confidence === "number");
}
function aiReviewHasPatches(record) {
    return "patches" in record && record.patches !== undefined;
}
function isSchemaGenerationLLMCall(log) {
    return log.purpose === "SCHEMA_GENERATION";
}
function isExportColumnPathValid(column) {
    return isAllowedRuntimeJsonPath(column.sourcePath);
}
function isTabularObjectValueTransformValid(format, value, column) {
    const isTabular = format === "CSV" || format === "EXCEL";
    const needsTransform = isTabular && typeof value === "object" && value !== null;
    return !needsTransform || column.transform !== undefined;
}
function isDefaultExportEligible(submission) {
    return submission.status === "ACCEPTED";
}
function usesPatchedAnswersExplicitly(mapping) {
    return mapping.answerSource === "PATCHED_ANSWERS";
}
function canUseUploadFileRef(fileRef, file, currentAssignmentId, currentUserId) {
    if (fileRef.fileId !== file.id)
        return false;
    if (file.ownerType === "ASSIGNMENT" && file.ownerId === currentAssignmentId)
        return true;
    if (file.ownerType === "USER" && file.ownerId === currentUserId)
        return true;
    return false;
}
function canUseDatasetImportFile(file) {
    return file.status === "READY" && file.purpose === "DATASET_IMPORT";
}
function canDownloadExportFile(file) {
    return file.status === "READY" && file.purpose === "EXPORT_RESULT";
}
function walkSchemaNode(node, visit) {
    visit(node);
    if (node.kind === "CONTAINER") {
        for (const child of node.children) {
            walkSchemaNode(child, visit);
        }
    }
}
function collectUnknownNodes(schema) {
    if (!isRecord(schema))
        return [];
    const root = schema.root;
    const nodes = [];
    walkUnknownNode(root, nodes);
    return nodes;
}
function walkUnknownNode(node, nodes) {
    if (!isRecord(node))
        return;
    nodes.push(node);
    const children = node.children;
    if (Array.isArray(children)) {
        for (const child of children) {
            walkUnknownNode(child, nodes);
        }
    }
}
function readString(value, key) {
    if (!isRecord(value))
        return undefined;
    const item = value[key];
    return typeof item === "string" ? item : undefined;
}
function isFieldVisible(field, context) {
    if (field.hidden === true)
        return false;
    if (field.visibleWhen !== undefined)
        return evaluateExpression(field.visibleWhen, context);
    return true;
}
function isRequiredField(field) {
    if (field.required === true)
        return true;
    return field.validations?.some((rule) => rule.type === "required") === true;
}
function isValueAcceptedByField(field, value) {
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
function isJsonSerializable(value) {
    try {
        JSON.stringify(value);
        return true;
    }
    catch {
        return false;
    }
}
function resolveExprValue(value, context) {
    if (value.kind === "literal") {
        return value.value;
    }
    return getPathValue(context, value.path);
}
function getPathValue(source, path) {
    if (!path.startsWith("$."))
        return undefined;
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
        if (!isRecord(current))
            return undefined;
        current = current[segment];
    }
    return current;
}
function compareValues(left, right, context, compare) {
    const leftValue = resolveExprValue(left, context);
    const rightValue = resolveExprValue(right, context);
    return typeof leftValue === "number" && typeof rightValue === "number" && compare(leftValue, rightValue);
}
function isInList(left, right) {
    if (Array.isArray(left)) {
        return left.some((item) => right.includes(item));
    }
    return right.includes(left);
}
function isEmptyValue(value) {
    if (value === undefined || value === null || value === "")
        return true;
    if (Array.isArray(value))
        return value.length === 0;
    if (isRecord(value))
        return Object.keys(value).length === 0;
    return false;
}
function stableStringify(value) {
    return JSON.stringify(sortObject(value));
}
function sortObject(value) {
    if (Array.isArray(value))
        return value.map(sortObject);
    if (!isRecord(value))
        return value;
    return Object.keys(value)
        .sort()
        .reduce((acc, key) => {
        acc[key] = sortObject(value[key]);
        return acc;
    }, {});
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
