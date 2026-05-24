import { http, HttpResponse } from "msw";
import type {
  BatchReviewRequest,
  ClaimTaskRequest,
  CreateExportJobRequest,
  CreateExportJobResponse,
  CreateUploadUrlRequest,
  CreateUploadUrlResponse,
  GenerateSchemaRequest,
  ImportDatasetRequest,
  PublishTaskRequest,
  PublishTaskResponse,
  ReviewDecisionRequest,
  SaveDraftRequest,
  SaveSchemaDraftRequest,
  SubmitAssignmentRequest,
  ConfirmUploadResponse,
  SchemaValidationResult,
  LabelHubSchema,
} from "@labelhub/contracts";
import {
  audit,
  batchDecideReview,
  callLLMAssist,
  claimReview,
  claimTask,
  confirmFile,
  createExport,
  createTask,
  createUploadFile,
  decideReview,
  generateSchema,
  getAssignmentContext,
  getReviewDetail,
  getTask,
  importDataset,
  listMarketplaceTasks,
  listMySubmissions,
  listReviewQueue,
  mockDb,
  publishSchema,
  publishTask,
  saveDraft,
  saveSchemaDraft,
  schemaHasDuplicateFieldName,
  schemaHasUnknownNodeType,
  submitAssignment,
  validateSchema,
} from "./mock-db";
import {
  errorJson,
  getParam,
  idempotencyScope,
  okJson,
  readJson,
  requestHash,
  type IdempotencyRecord,
  type MockParams,
} from "./mock-utils";

const idempotencyRecords = new Map<string, IdempotencyRecord>();

export const handlers = [
  http.post("/api/v1/tasks", async ({ request }) => {
    const body = await readJson<Pick<Parameters<typeof createTask>[0], "title" | "description"> & Partial<Parameters<typeof createTask>[0]>>(request);
    return withIdempotency(request, body, () => {
      if (body.title === undefined || body.description === undefined) {
        return { body: validationError("任务标题和描述不能为空"), status: 422 };
      }
      return { body: createTask(body), status: 201 };
    });
  }),

  http.get("/api/v1/tasks/:taskId", ({ params }) => {
    const task = getTask(getParam(params as MockParams, "taskId"));
    return task === undefined ? errorJson("RESOURCE_NOT_FOUND", "任务不存在", 404) : okJson(task);
  }),

  http.put("/api/v1/tasks/:taskId/schema/draft", async ({ request, params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const body = await readJson<SaveSchemaDraftRequest>(request);
    return withIdempotency(request, body, () => {
      const response = saveSchemaDraft(taskId, body.schema);
      return { body: response };
    });
  }),

  http.post("/api/v1/schema/validate", async ({ request }) => {
    const schema = await readJson<LabelHubSchema>(request);
    const validation = validateSchema(schema);
    if (schemaHasUnknownNodeType(schema)) {
      return errorJson("UNKNOWN_NODE_TYPE", "schema 包含未知 node type", 400, validation);
    }
    if (schemaHasDuplicateFieldName(schema)) {
      return errorJson("FIELD_NAME_DUPLICATED", "schema 包含重复 FieldNode.name", 400, validation);
    }
    return okJson<SchemaValidationResult>(validation);
  }),

  http.post("/api/v1/tasks/:taskId/schema/ai-generate", async ({ request, params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const body = await readJson<GenerateSchemaRequest>(request);
    return withIdempotency(request, body, () => ({ body: generateSchema(taskId, body.taskDescription) }));
  }),

  http.post("/api/v1/tasks/:taskId/schema/publish", async ({ request, params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const body = await readJson<unknown>(request);
    return withIdempotency(request, body, () => {
      const schemaVersion = publishSchema(taskId);
      if (schemaVersion === undefined) {
        return { body: apiErrorBody("SCHEMA_INVALID", "schema draft 不存在"), status: 400 };
      }
      return { body: { schemaVersion, auditLog: audit("SCHEMA_VERSION_PUBLISHED") } };
    });
  }),

  http.post("/api/v1/tasks/:taskId/publish", async ({ request, params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const body = await readJson<PublishTaskRequest>(request);
    return withIdempotency(request, body, () => {
      const task = publishTask(taskId, body.schemaVersionId);
      const schemaVersion = mockDb.schemaVersions.find((item) => item.id === body.schemaVersionId);
      if (task === undefined || schemaVersion === undefined) {
        return { body: apiErrorBody("INVALID_STATE_TRANSITION", "任务无法发布"), status: 409 };
      }
      const response: PublishTaskResponse = {
        task,
        schemaVersion,
        auditLog: audit("TASK_PUBLISHED"),
      };
      return { body: response };
    });
  }),

  http.post("/api/v1/tasks/:taskId/dataset/import", async ({ request, params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const body = await readJson<ImportDatasetRequest>(request);
    return withIdempotency(request, body, () => {
      const response = importDataset(taskId, body.fileId);
      return response === undefined
        ? { body: apiErrorBody("FILE_NOT_READY", "数据集导入文件必须是 READY + DATASET_IMPORT"), status: 400 }
        : { body: response };
    });
  }),

  http.post("/api/v1/tasks/:taskId/exports", async ({ request, params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const body = await readJson<CreateExportJobRequest>(request);
    return withIdempotency(request, body, () => {
      const exportJob = createExport(taskId, body.mapping);
      const response: CreateExportJobResponse = {
        exportJob,
        auditLog: audit("EXPORT_CREATED"),
      };
      return { body: response, status: 201 };
    });
  }),

  http.get("/api/v1/tasks/:taskId/exports", ({ params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    return okJson(mockDb.exportJobs.filter((item) => item.taskId === taskId));
  }),

  http.get("/api/v1/exports/:exportJobId", ({ params }) => {
    const exportJob = mockDb.exportJobs.find((item) => item.id === getParam(params as MockParams, "exportJobId"));
    return exportJob === undefined ? errorJson("RESOURCE_NOT_FOUND", "导出任务不存在", 404) : okJson({ exportJob });
  }),

  http.get("/api/v1/marketplace/tasks", () => okJson(listMarketplaceTasks())),

  http.post("/api/v1/tasks/:taskId/claim", async ({ request, params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const body = await readJson<ClaimTaskRequest>(request);
    return withIdempotency(request, body, () => {
      const response = claimTask(taskId);
      return response === undefined
        ? { body: apiErrorBody("INVALID_STATE_TRANSITION", "当前任务无法领取"), status: 409 }
        : { body: response, status: 201 };
    });
  }),

  http.get("/api/v1/assignments/:assignmentId", ({ params }) => {
    const context = getAssignmentContext(getParam(params as MockParams, "assignmentId"));
    return context === undefined ? errorJson("RESOURCE_NOT_FOUND", "作答上下文不存在", 404) : okJson(context);
  }),

  http.put("/api/v1/assignments/:assignmentId/draft", async ({ request, params }) => {
    const assignmentId = getParam(params as MockParams, "assignmentId");
    const body = await readJson<SaveDraftRequest>(request);
    return withIdempotency(request, body, () => {
      const response = saveDraft(assignmentId, body.answers, body.clientRevision);
      return response === undefined
        ? { body: apiErrorBody("INVALID_STATE_TRANSITION", "当前 assignment 无法保存草稿"), status: 409 }
        : { body: response };
    });
  }),

  http.post("/api/v1/assignments/:assignmentId/submit", async ({ request, params }) => {
    const assignmentId = getParam(params as MockParams, "assignmentId");
    const body = await readJson<SubmitAssignmentRequest>(request);
    return withIdempotency(request, body, () => {
      const response = submitAssignment(assignmentId, body.answers);
      if (response === undefined) {
        return { body: apiErrorBody("INVALID_STATE_TRANSITION", "当前 assignment 无法提交"), status: 409 };
      }
      if (!response.validation.valid) {
        return { body: apiErrorBody("VALIDATION_FAILED", "提交校验失败", response.validation), status: 422 };
      }
      return { body: response, status: 201 };
    });
  }),

  http.post("/api/v1/assignments/:assignmentId/llm-assist", async ({ request }) => {
    const body = await readJson<unknown>(request);
    return withIdempotency(request, body, () => ({ body: callLLMAssist() }));
  }),

  http.get("/api/v1/me/submissions", () => okJson(listMySubmissions())),

  http.get("/api/v1/review/queue", () => okJson(listReviewQueue())),

  http.get("/api/v1/review/submissions/:submissionId", ({ params }) => {
    const detail = getReviewDetail(getParam(params as MockParams, "submissionId"));
    return detail === undefined ? errorJson("RESOURCE_NOT_FOUND", "审核详情不存在", 404) : okJson(detail);
  }),

  http.post("/api/v1/review/submissions/:submissionId/claim", async ({ request, params }) => {
    const submissionId = getParam(params as MockParams, "submissionId");
    const body = await readJson<unknown>(request);
    return withIdempotency(request, body, () => {
      const submission = claimReview(submissionId);
      return submission === undefined
        ? { body: apiErrorBody("INVALID_STATE_TRANSITION", "当前 submission 无法领取审核"), status: 409 }
        : { body: submission };
    });
  }),

  http.post("/api/v1/review/submissions/:submissionId/decision", async ({ request, params }) => {
    const body = await readJson<ReviewDecisionRequest>(request);
    const submissionId = getParam(params as MockParams, "submissionId");
    return withIdempotency(request, body, () => {
      if (body.submissionId !== submissionId) {
        return { body: apiErrorBody("VALIDATION_FAILED", "路径 submissionId 与请求体不一致"), status: 422 };
      }
      if (body.decision === "RETURN" && body.reason === undefined) {
        return { body: apiErrorBody("REVIEW_REASON_REQUIRED", "RETURN 决策必须填写 reason"), status: 422 };
      }
      const response = decideReview(body);
      return response === undefined
        ? { body: apiErrorBody("INVALID_STATE_TRANSITION", "当前审核状态不允许该决策"), status: 409 }
        : { body: response };
    });
  }),

  http.post("/api/v1/review/batch-decision", async ({ request }) => {
    const body = await readJson<BatchReviewRequest>(request);
    return withIdempotency(request, body, () => ({ body: batchDecideReview(body.items) }));
  }),

  http.get("/api/v1/schema/component-registry", () => okJson(mockDb.registry)),

  http.get("/api/v1/schema-versions/:schemaVersionId", ({ params }) => {
    const schemaVersion = mockDb.schemaVersions.find((item) => item.id === getParam(params as MockParams, "schemaVersionId"));
    return schemaVersion === undefined ? errorJson("RESOURCE_NOT_FOUND", "schema version 不存在", 404) : okJson(schemaVersion);
  }),

  http.post("/api/v1/files/upload-url", async ({ request }) => {
    const body = await readJson<CreateUploadUrlRequest>(request);
    return withIdempotency(request, body, () => {
      const file = createUploadFile(body);
      const response: CreateUploadUrlResponse = {
        file,
        uploadUrl: `/mock-upload/${file.id}`,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      };
      return { body: response, status: 201 };
    });
  }),

  http.post("/api/v1/files/:fileId/confirm", async ({ request, params }) => {
    const body = await readJson<unknown>(request);
    const fileId = getParam(params as MockParams, "fileId");
    return withIdempotency(request, body, () => {
      const file = confirmFile(fileId);
      if (file === undefined) {
        return { body: apiErrorBody("RESOURCE_NOT_FOUND", "文件不存在"), status: 404 };
      }
      const response: ConfirmUploadResponse = { file };
      return { body: response };
    });
  }),
];

interface MockHandlerResult {
  body: unknown;
  status?: number;
}

function withIdempotency(request: Request, body: unknown, create: () => MockHandlerResult): Response {
  const scope = idempotencyScope(request);
  if (scope === undefined) {
    const result = create();
    return HttpResponse.json(result.body, { status: result.status ?? 200 });
  }
  const hash = requestHash(body);
  const existing = idempotencyRecords.get(scope);
  if (existing !== undefined) {
    if (existing.requestHash !== hash) {
      return errorJson("IDEMPOTENCY_CONFLICT", "相同 Idempotency-Key 对应的 request body 不一致", 409);
    }
    return HttpResponse.json(existing.response, { status: existing.status });
  }
  const result = create();
  const status = result.status ?? 200;
  idempotencyRecords.set(scope, {
    requestHash: hash,
    response: result.body,
    status,
  });
  return HttpResponse.json(result.body, { status });
}

function validationError(message: string): { code: "VALIDATION_FAILED"; message: string; traceId: string } {
  return {
    code: "VALIDATION_FAILED",
    message,
    traceId: `trace_${Date.now()}`,
  };
}

function apiErrorBody(code: Parameters<typeof errorJson>[0], message: string, details?: unknown): { code: Parameters<typeof errorJson>[0]; message: string; details?: unknown; traceId: string } {
  return {
    code,
    message,
    details,
    traceId: `trace_${Date.now()}`,
  };
}
