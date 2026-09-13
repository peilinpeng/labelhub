import type {
  GenerateSchemaResponse,
  LabelHubSchema,
  PublishedLabelHubSchema,
  SaveSchemaDraftResponse,
  SchemaValidationResult,
  SchemaVersion,
  Task,
} from "@labelhub/contracts";
import { collectSchemaNodes, isAnswerFieldNode, validateSchemaInvariants } from "@labelhub/contracts";
import { newsQualitySchemaDraft } from "../data/schemas.mock";
import { clone, nextId, now } from "../mock-utils";
import { audit } from "./audit";
import { mockDb } from "./state";

export function listMarketplaceTasks(): Task[] {
  return mockDb.tasks.filter((task) => task.status === "PUBLISHED");
}

export function getTask(taskId: string): Task | undefined {
  return mockDb.tasks.find((task) => task.id === taskId) ?? createRestoredDraftTask(taskId);
}

export function getSchemaDraft(taskId: string): LabelHubSchema | undefined {
  const draft = mockDb.schemaDrafts.find((item) => item.meta.taskId === taskId);
  if (draft !== undefined) {
    return draft;
  }

  const task = getTask(taskId);
  return task === undefined ? undefined : createSchemaDraftForTask(task);
}

export function createTask(input: Pick<Task, "title" | "description"> & Partial<Task>): Task {
  const task: Task = {
    id: input.id ?? nextId("task"),
    title: input.title,
    description: input.description,
    tags: input.tags ?? [],
    quota: input.quota ?? { total: 100 },
    distributionStrategy: input.distributionStrategy ?? { type: "FIRST_COME_FIRST_SERVED" },
    reviewPolicy: input.reviewPolicy ?? { type: "SINGLE_REVIEW" },
    status: "DRAFT",
    ownerId: input.ownerId ?? "usr_owner",
    createdAt: now(),
    updatedAt: now(),
  };
  if (input.instructionRichText !== undefined) task.instructionRichText = input.instructionRichText;
  if (input.rewardRule !== undefined) task.rewardRule = input.rewardRule;
  if (input.deadlineAt !== undefined) task.deadlineAt = input.deadlineAt;
  if (input.activeSchemaVersionId !== undefined) task.activeSchemaVersionId = input.activeSchemaVersionId;
  mockDb.tasks.push(task);
  createSchemaDraftForTask(task);
  return task;
}

function createRestoredDraftTask(taskId: string): Task | undefined {
  if (!/^task_\d+$/.test(taskId)) {
    return undefined;
  }

  return createTask({
    id: taskId as Task["id"],
    title: "新建任务草稿",
    description: "这是 Mock 环境根据动态路由恢复的任务草稿。",
  });
}

function createSchemaDraftForTask(task: Task): LabelHubSchema {
  const existing = mockDb.schemaDrafts.find((item) => item.meta.taskId === task.id);
  if (existing !== undefined) {
    return existing;
  }

  const source = clone(newsQualitySchemaDraft);
  const createdAt = now();
  const draft: LabelHubSchema = {
    ...source,
    schemaId: createSchemaId(task.id),
    schemaDraftRevision: 1,
    status: "DRAFT",
    meta: {
      ...source.meta,
      name: `${task.title}模板`,
      description: task.description,
      taskId: task.id as LabelHubSchema["meta"]["taskId"],
      authorId: task.ownerId,
      createdAt,
      updatedAt: createdAt,
    },
  };
  mockDb.schemaDrafts.push(draft);
  return draft;
}

function createSchemaId(taskId: string): LabelHubSchema["schemaId"] {
  return `schema_${taskId.replace(/^task_/, "")}` as LabelHubSchema["schemaId"];
}

export function saveSchemaDraft(taskId: string, schema: LabelHubSchema): SaveSchemaDraftResponse {
  const previous = mockDb.schemaDrafts.find((item) => item.meta.taskId === taskId);
  const revision = (previous?.schemaDraftRevision ?? 0) + 1;
  const { schemaVersionId: _schemaVersionId, schemaVersionNo: _schemaVersionNo, ...schemaWithoutVersion } = schema;
  void _schemaVersionId;
  void _schemaVersionNo;
  const nextSchema: LabelHubSchema = {
    ...schemaWithoutVersion,
    status: "DRAFT",
    schemaDraftRevision: revision,
    meta: {
      ...schema.meta,
      taskId: taskId as LabelHubSchema["meta"]["taskId"],
      updatedAt: now(),
    },
  };
  mockDb.schemaDrafts = mockDb.schemaDrafts.filter((item) => item.meta.taskId !== taskId);
  mockDb.schemaDrafts.push(nextSchema);
  return {
    schema: nextSchema,
    schemaDraftRevision: revision,
    validation: validateSchema(nextSchema),
    auditLog: audit("SCHEMA_DRAFT_SAVED"),
  };
}

export function validateSchema(schema: unknown): SchemaValidationResult {
  const violations = validateSchemaInvariants(schema);
  return {
    valid: violations.length === 0,
    errors: violations.map((violation) => {
      const error = {
        path: violation.fieldName ?? violation.nodeId ?? "$",
        code: violation.code,
        message: violation.message,
      };
      return violation.nodeId === undefined ? error : { ...error, nodeId: violation.nodeId };
    }),
    warnings: [],
  };
}

export function generateSchema(taskId: string, taskDescription: string): GenerateSchemaResponse {
  const source = mockDb.schemaDrafts.find((schema) => schema.meta.taskId === taskId) ?? newsQualitySchemaDraft;
  const clonedSource = clone(source);
  const { schemaVersionId: _schemaVersionId, schemaVersionNo: _schemaVersionNo, ...sourceWithoutVersion } = clonedSource;
  void _schemaVersionId;
  void _schemaVersionNo;
  const schemaDraft: LabelHubSchema = {
    ...sourceWithoutVersion,
    status: "DRAFT",
    schemaDraftRevision: (source.schemaDraftRevision ?? 0) + 1,
    meta: {
      ...source.meta,
      description: taskDescription,
      updatedAt: now(),
    },
  };
  const validation = validateSchema(schemaDraft);
  return {
    schemaDraft,
    validation,
    warnings: validation.warnings,
    generatedBy: {
      modelPolicyId: "mock-schema-generator",
      promptSnapshotHash: "mock_prompt_schema_generation",
      llmCallId: nextId("llm"),
    },
  };
}

export function publishSchema(taskId: string): SchemaVersion | undefined {
  const draft = mockDb.schemaDrafts.find((schema) => schema.meta.taskId === taskId);
  if (draft === undefined) return undefined;
  const versionNo = mockDb.schemaVersions.filter((item) => item.taskId === taskId).length + 1;
  const schemaVersionId = nextId("sv");
  const snapshot: PublishedLabelHubSchema = {
    ...clone(draft),
    schemaVersionId,
    schemaVersionNo: versionNo,
    status: "PUBLISHED",
    meta: {
      ...draft.meta,
      publishedAt: now(),
      updatedAt: now(),
    },
  };
  const schemaVersion: SchemaVersion = {
    id: schemaVersionId,
    schemaId: draft.schemaId,
    taskId: taskId as SchemaVersion["taskId"],
    schemaVersionNo: versionNo,
    contractVersion: "1.1",
    snapshot,
    createdAt: now(),
  };
  mockDb.schemaVersions.push(schemaVersion);
  return schemaVersion;
}

export function publishTask(taskId: string, schemaVersionId: string): Task | undefined {
  const task = getTask(taskId);
  const schemaVersion = mockDb.schemaVersions.find((item) => item.id === schemaVersionId && item.taskId === taskId);
  if (task === undefined || schemaVersion === undefined || task.status !== "DRAFT") return undefined;
  task.status = "PUBLISHED";
  task.activeSchemaVersionId = schemaVersion.id;
  task.updatedAt = now();
  return task;
}

export function schemaHasUnknownNodeType(schema: unknown): boolean {
  return validateSchemaInvariants(schema).some((item) => item.code === "UNKNOWN_NODE_TYPE");
}

export function schemaHasDuplicateFieldName(schema: unknown): boolean {
  return validateSchemaInvariants(schema).some((item) => item.code === "FIELD_NAME_DUPLICATED");
}

export function getFieldNames(schema: LabelHubSchema): string[] {
  return collectSchemaNodes(schema)
    .filter(isAnswerFieldNode)
    .map((node) => node.name);
}
