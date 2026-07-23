import { http, HttpResponse } from "msw";
import type {
  AiAssistActionRequest,
  BatchReviewRequest,
  ClaimTaskRequest,
  AppendAuditEventRequest,
  AuditEventQuery,
  AuditEventType,
  AuditSeverity,
  AuditSource,
  AuditTargetEntityType,
  CreateExportJobRequest,
  CreateExportJobResponse,
  CreateUploadUrlRequest,
  CreateUploadUrlResponse,
  GenerateSchemaRequest,
  GetExportArtifactRecordsResponse,
  ImportDatasetRequest,
  PublishTaskRequest,
  PublishTaskResponse,
  ReviewDecisionRequest,
  SaveDraftRequest,
  SaveSchemaDraftRequest,
  SubmitAssignmentRequest,
  ConfirmUploadResponse,
  QueryAuditEventsResponse,
  SchemaValidationResult,
  LabelHubSchema,
} from "@labelhub/contracts";
import {
  appendAuditEvent,
  applyAiAssistAction,
  audit,
  batchDecideReview,
  deriveAiAssistSuggestions,
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
  getExportArtifactSummary,
  getReviewDetail,
  getSchemaDraft,
  getTask,
  importDataset,
  listAssignmentDatasetItems,
  listExportRecords,
  listMarketplaceTasks,
  listMySubmissions,
  listReviewQueue,
  mockDb,
  publishSchema,
  publishTask,
  queryAuditEvents,
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

// AI 预审配置（review-config）会话内存 store：按 taskId 持久化创建/更新，
// 缺省返回一份可演示的预审规则，避免 OwnerAIPage 拉取时落空触发 401。
const reviewConfigStore = new Map<string, Record<string, unknown>>();

function defaultReviewConfig(taskId: string): Record<string, unknown> {
  return {
    id: `rc_${taskId}`,
    taskId,
    enabled: true,
    modelPolicyId: "doubao-pro-32k",
    promptTemplate:
      "你是 LabelHub 的 AI 预审 Agent。请基于题目内容、标注答案和当前 schema 输出结构化审核结果，" +
      "使用 function_calling 返回 decision、totalScore、dimensionScores、fieldIssues、summary、confidence。",
    dimensions: [
      { key: "factuality", label: "事实完整性", description: "事实表述是否完整、可核查", weight: 0.3, scoreRange: [0, 1] },
      { key: "category", label: "类别准确性", description: "类别选择是否符合内容", weight: 0.25, scoreRange: [0, 1] },
      { key: "evidence", label: "证据充分性", description: "是否提供来源、证据或复核说明", weight: 0.25, scoreRange: [0, 1] },
      { key: "format", label: "格式合规", description: "答案格式和必填项是否合规", weight: 0.2, scoreRange: [0, 1] },
    ],
    thresholds: { passScore: 0.8, returnScore: 0.45 },
    conclusionMapping: {
      passWhen: "totalScore >= 0.8",
      returnWhen: "totalScore < 0.45",
      humanReviewOtherwise: true,
    },
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function readReviewConfig(taskId: string): Record<string, unknown> {
  if (!reviewConfigStore.has(taskId)) {
    reviewConfigStore.set(taskId, defaultReviewConfig(taskId));
  }
  return reviewConfigStore.get(taskId)!;
}

function writeReviewConfig(taskId: string, payload: Record<string, unknown>): Record<string, unknown> {
  const existing = reviewConfigStore.get(taskId) ?? defaultReviewConfig(taskId);
  const merged = {
    ...existing,
    ...payload,
    id: (existing.id as string | undefined) ?? `rc_${taskId}`,
    taskId,
    updatedAt: new Date().toISOString(),
  };
  reviewConfigStore.set(taskId, merged);
  return merged;
}

export const handlers = [
  http.post("*/api/v1/auth/login", async ({ request }) => {
    const body = await readJson<{ email?: unknown; password?: unknown }>(request);
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    const actor = demoActorForEmail(email);
    if (actor === undefined || password.length === 0) {
      return errorJson("PERMISSION_DENIED", "账号或密码不正确", 401);
    }
    return okJson({
      token: `mock_token_${actor.role.toLowerCase()}`,
      actor,
    });
  }),

  http.get("*/api/v1/tasks", () => okJson(mockDb.tasks)),

  http.post("*/api/v1/tasks", async ({ request }) => {
    const body = await readJson<Pick<Parameters<typeof createTask>[0], "title" | "description"> & Partial<Parameters<typeof createTask>[0]>>(request);
    return withIdempotency(request, body, () => {
      if (body.title === undefined || body.description === undefined) {
        return { body: validationError("任务标题和描述不能为空"), status: 422 };
      }
      return { body: createTask(body), status: 201 };
    });
  }),

  http.get("*/api/v1/tasks/:taskId", ({ params }) => {
    const task = getTask(getParam(params as MockParams, "taskId"));
    return task === undefined ? errorJson("RESOURCE_NOT_FOUND", "任务不存在", 404) : okJson(task);
  }),

  http.get("*/api/v1/tasks/:taskId/schema/draft", ({ params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const draft = getSchemaDraft(taskId);
    return draft === undefined ? errorJson("RESOURCE_NOT_FOUND", "schema draft 不存在", 404) : okJson(draft);
  }),

  // 版本历史：映射 mock 的 SchemaVersion（snapshot/createdAt）为后端响应形状（schema/publishedAt），倒序。
  http.get("*/api/v1/tasks/:taskId/schema-versions", ({ params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const versions = mockDb.schemaVersions
      .filter((v) => v.taskId === taskId)
      .slice()
      .sort((a, b) => b.schemaVersionNo - a.schemaVersionNo)
      .map((v) => ({
        id: v.id,
        taskId: v.taskId,
        schemaId: v.schemaId,
        schemaVersionNo: v.schemaVersionNo,
        contractVersion: v.contractVersion,
        schema: v.snapshot,
        publishedAt: v.createdAt,
      }));
    return okJson({ schemaVersions: versions });
  }),

  http.put("*/api/v1/tasks/:taskId/schema/draft", async ({ request, params }) => {
    return handleSaveSchemaDraftRequest(request, params as MockParams);
  }),

  http.put("*/api/v1/tasks/:taskId/schema/draft", async ({ request, params }) => {
    return handleSaveSchemaDraftRequest(request, params as MockParams);
  }),

  http.post("*/api/v1/schema/validate", async ({ request }) => {
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

  http.post("*/api/v1/tasks/:taskId/schema/ai-generate", async ({ request, params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const body = await readJson<GenerateSchemaRequest>(request);
    return withIdempotency(request, body, () => ({ body: generateSchema(taskId, body.taskDescription) }));
  }),

  http.get("*/api/v1/tasks/:taskId/review-config", ({ params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    return okJson({ reviewConfig: readReviewConfig(taskId) });
  }),

  http.post("*/api/v1/tasks/:taskId/review-config", async ({ request, params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const body = await readJson<Record<string, unknown>>(request);
    return okJson({ reviewConfig: writeReviewConfig(taskId, body) });
  }),

  http.put("*/api/v1/tasks/:taskId/review-config", async ({ request, params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const body = await readJson<Record<string, unknown>>(request);
    return okJson({ reviewConfig: writeReviewConfig(taskId, body) });
  }),

  http.post("*/api/v1/tasks/:taskId/schema/publish", async ({ request, params }) => {
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

  http.post("*/api/v1/tasks/:taskId/publish", async ({ request, params }) => {
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

  http.post("*/api/v1/tasks/:taskId/dataset/import", async ({ request, params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const body = await readJson<ImportDatasetRequest>(request);
    return withIdempotency(request, body, () => {
      const response = importDataset(taskId, body.fileId);
      return response === undefined
        ? { body: apiErrorBody("FILE_NOT_READY", "数据集导入文件必须是 READY + DATASET_IMPORT"), status: 400 }
        : { body: response };
    });
  }),

  http.post("*/api/v1/tasks/:taskId/exports", async ({ request, params }) => {
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

  http.get("*/api/v1/tasks/:taskId/exports", ({ params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    return okJson(mockDb.exportJobs.filter((item) => item.taskId === taskId));
  }),

  http.get("*/api/v1/exports/:exportId/records", ({ params }) => {
    const exportId = getParam(params as MockParams, "exportId");
    const artifactSummary = getExportArtifactSummary(exportId);
    if (artifactSummary === undefined) {
      return errorJson("RESOURCE_NOT_FOUND", "导出产物记录不存在", 404);
    }
    const response: GetExportArtifactRecordsResponse = {
      exportId,
      records: listExportRecords(exportId),
      artifactSummary,
    };
    return okJson(response);
  }),

  http.get("*/api/v1/exports/:exportJobId", ({ params }) => {
    const exportJob = mockDb.exportJobs.find((item) => item.id === getParam(params as MockParams, "exportJobId"));
    return exportJob === undefined ? errorJson("RESOURCE_NOT_FOUND", "导出任务不存在", 404) : okJson({ exportJob });
  }),

  // 数据看板（只读聚合）。mock 返回一份代表性数据，保证页面渲染与空状态逻辑可被验证。
  http.get("*/api/v1/analytics/dashboard", () =>
    okJson({
      scope: { taskId: null, taskTitle: null },
      aiCost: {
        byPurpose: [
          { purpose: "AI_REVIEW", scope: "global", calls: 24, succeeded: 22, failed: 2, failureRate: 0.083, totalTokens: 48230, tokenCoverage: 1, avgLatencyMs: 1820 },
          { purpose: "LLM_ASSIST", scope: "global", calls: 13, succeeded: 13, failed: 0, failureRate: 0, totalTokens: 9120, tokenCoverage: 1, avgLatencyMs: 940 },
          { purpose: "SCHEMA_GENERATION", scope: "global", calls: 5, succeeded: 5, failed: 0, failureRate: 0, totalTokens: 15400, tokenCoverage: 1, avgLatencyMs: 3100 },
        ],
        totalCalls: 42,
        totalTokens: 72750,
        schemaGenerationTaskScoped: false,
      },
      labelers: [
        { labelerId: "usr_demo_labeler", displayName: "演示标注员", submitted: 11, accepted: 8, returned: 2, rejected: 0, inReview: 1, acceptRate: 0.8, returnRate: 0.2, avgAiScore: 86.5, reviewerPatchedFields: 4 },
      ],
      aiQuality: {
        aiRawTotal: 18,
        byRawDecision: { PASS: 9, RETURN: 4, NEED_HUMAN_REVIEW: 5 },
        humanReviewRate: 0.278,
        evaluated: 13,
        agreements: 11,
        agreementRate: 0.846,
      },
    }),
  ),

  http.get("*/api/v1/marketplace/tasks", () => okJson(listMarketplaceTasks())),

  http.post("*/api/v1/tasks/:taskId/claim", async ({ request, params }) => {
    const taskId = getParam(params as MockParams, "taskId");
    const body = await readJson<ClaimTaskRequest>(request);
    return withIdempotency(request, body, () => {
      const response = claimTask(taskId);
      return response === undefined
        ? { body: apiErrorBody("INVALID_STATE_TRANSITION", "当前任务无法领取"), status: 409 }
        : { body: response, status: 201 };
    });
  }),

  http.get("*/api/v1/assignments/:assignmentId", ({ params }) => {
    const context = getAssignmentContext(getParam(params as MockParams, "assignmentId"));
    return context === undefined ? errorJson("RESOURCE_NOT_FOUND", "作答上下文不存在", 404) : okJson(context);
  }),

  http.get("*/api/v1/assignments/:assignmentId/items", ({ params }) => {
    const items = listAssignmentDatasetItems(getParam(params as MockParams, "assignmentId"));
    return okJson({ items });
  }),

  http.put("*/api/v1/assignments/:assignmentId/draft", async ({ request, params }) => {
    const assignmentId = getParam(params as MockParams, "assignmentId");
    const body = await readJson<SaveDraftRequest>(request);
    return withIdempotency(request, body, () => {
      const response = saveDraft(assignmentId, body.answers, body.clientRevision);
      return response === undefined
        ? { body: apiErrorBody("INVALID_STATE_TRANSITION", "当前 assignment 无法保存草稿"), status: 409 }
        : { body: response };
    });
  }),

  http.post("*/api/v1/assignments/:assignmentId/submit", async ({ request, params }) => {
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

  http.post("*/api/v1/assignments/:assignmentId/llm-assist", async ({ request }) => {
    const body = await readJson<unknown>(request);
    return withIdempotency(request, body, async () => ({ body: await callLLMAssist(readLLMAssistRequest(body)) }));
  }),

  http.get("*/api/v1/me/submissions", () => okJson(listMySubmissions())),

  http.get("*/api/v1/review/queue", () =>
    // 契约要求 ReviewQueueItem（{ submission, taskId, taskTitle, itemId, aiDecision }）；
    // mock-db 内部存的是原始 Submission，这里包装成队列项形状，否则前端按 item.submission.* 读取会全部落空。
    okJson(
      listReviewQueue().map((submission) => ({
        submission: {
          id: submission.id,
          assignmentId: submission.assignmentId,
          taskId: submission.taskId,
          itemId: submission.itemId,
          labelerId: submission.labelerId,
          schemaVersionId: submission.schemaVersionId,
          attemptNo: submission.attemptNo,
          status: submission.status,
          createdAt: submission.createdAt ?? new Date().toISOString(),
          updatedAt: submission.updatedAt ?? submission.createdAt ?? new Date().toISOString(),
        },
        taskId: submission.taskId,
        taskTitle: mockDb.tasks.find((task) => task.id === submission.taskId)?.title ?? submission.taskId,
        itemId: submission.itemId,
        aiDecision: null,
      })),
    ),
  ),

  http.get("*/api/v1/review/submissions/:submissionId", ({ params }) => {
    const detail = getReviewDetail(getParam(params as MockParams, "submissionId"));
    return detail === undefined ? errorJson("RESOURCE_NOT_FOUND", "审核详情不存在", 404) : okJson(detail);
  }),

  http.post("*/api/v1/review/submissions/:submissionId/claim", async ({ request, params }) => {
    const submissionId = getParam(params as MockParams, "submissionId");
    const body = await readJson<unknown>(request);
    return withIdempotency(request, body, () => {
      const submission = claimReview(submissionId);
      return submission === undefined
        ? { body: apiErrorBody("INVALID_STATE_TRANSITION", "当前 submission 无法领取审核"), status: 409 }
        : { body: submission };
    });
  }),

  http.post("*/api/v1/review/submissions/:submissionId/decision", async ({ request, params }) => {
    const body = await readJson<ReviewDecisionRequest>(request);
    const submissionId = getParam(params as MockParams, "submissionId");
    return withIdempotency(request, body, () => {
      if (body.submissionId !== submissionId) {
        return { body: apiErrorBody("VALIDATION_FAILED", "路径 submissionId 与请求体不一致"), status: 422 };
      }
      // 与后端 review_domain.submit_review_decision 对齐：RETURN / REJECT 必须有非空 reason，
      // 空字符串 / 纯空白也视为缺失（此前仅判 undefined，空意见可绕过必填校验）。
      if ((body.decision === "RETURN" || body.decision === "REJECT") && (body.reason ?? "").trim() === "") {
        return { body: apiErrorBody("REVIEW_REASON_REQUIRED", `${body.decision} 决策必须填写 reason`), status: 422 };
      }
      const response = decideReview(body);
      return response === undefined
        ? { body: apiErrorBody("INVALID_STATE_TRANSITION", "当前审核状态不允许该决策"), status: 409 }
        : { body: response };
    });
  }),

  http.get("*/api/v1/review/submissions/:submissionId/ai-assist/suggestions", ({ params }) => {
    const submissionId = getParam(params as MockParams, "submissionId");
    const submission = mockDb.submissions.find((item) => item.id === submissionId);
    if (submission === undefined) {
      return errorJson("RESOURCE_NOT_FOUND", "审核详情不存在", 404);
    }
    return okJson({ suggestions: deriveAiAssistSuggestions(submissionId) });
  }),

  http.post(
    "*/api/v1/review/submissions/:submissionId/ai-assist/:suggestionId/actions",
    async ({ request, params }) => {
      const submissionId = getParam(params as MockParams, "submissionId");
      const suggestionId = getParam(params as MockParams, "suggestionId");
      const body = await readJson<AiAssistActionRequest>(request);
      return withIdempotency(request, body, () => {
        if (!["accept", "edit_accept", "dismiss"].includes(body.action)) {
          return { body: apiErrorBody("VALIDATION_FAILED", "AI Assist 动作不合法"), status: 422 };
        }
        const result = applyAiAssistAction(submissionId, suggestionId, body);
        if (result === undefined) {
          return { body: apiErrorBody("RESOURCE_NOT_FOUND", "审核详情不存在"), status: 404 };
        }
        if ("error" in result) {
          return { body: apiErrorBody("RESOURCE_NOT_FOUND", "AI 建议不存在"), status: 404 };
        }
        return { body: result, status: 201 };
      });
    },
  ),

  http.post("*/api/v1/review/batch-decision", async ({ request }) => {
    const body = await readJson<BatchReviewRequest>(request);
    return withIdempotency(request, body, () => ({ body: batchDecideReview(body.items) }));
  }),

  http.post("*/api/v1/audit-events", async ({ request }) => {
    const body = await readJson<AppendAuditEventRequest>(request);
    return okJson({ event: appendAuditEvent(body) }, 201);
  }),

  http.get("*/api/v1/audit-events", ({ request }) => {
    const query = parseAuditEventQuery(new URL(request.url).searchParams);
    return okJson<QueryAuditEventsResponse>(queryAuditEvents(query));
  }),

  http.get("*/api/v1/schema/component-registry", () => okJson(mockDb.registry)),

  http.get("*/api/v1/schema-versions/:schemaVersionId", ({ params }) => {
    const schemaVersion = mockDb.schemaVersions.find((item) => item.id === getParam(params as MockParams, "schemaVersionId"));
    return schemaVersion === undefined ? errorJson("RESOURCE_NOT_FOUND", "schema version 不存在", 404) : okJson(schemaVersion);
  }),

  http.post("*/api/v1/files/upload-url", async ({ request }) => {
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

  http.post("*/api/v1/files/:fileId/confirm", async ({ request, params }) => {
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

  http.get(/\/(owner|labeler|reviewer)(\/.*)?$/, async ({ request }) => {
    return handleAppRouteRequest(request);
  }),
];

interface MockHandlerResult {
  body: unknown;
  status?: number;
}

type MaybePromise<T> = T | Promise<T>;

async function withIdempotency(request: Request, body: unknown, create: () => MaybePromise<MockHandlerResult>): Promise<Response> {
  const scope = idempotencyScope(request);
  if (scope === undefined) {
    const result = await create();
    return HttpResponse.json(result.body as never, { status: result.status ?? 200 });
  }
  const hash = requestHash(body);
  const existing = idempotencyRecords.get(scope);
  if (existing !== undefined) {
    if (existing.requestHash !== hash) {
      return errorJson("IDEMPOTENCY_CONFLICT", "相同 Idempotency-Key 对应的 request body 不一致", 409);
    }
    return HttpResponse.json(existing.response as never, { status: existing.status });
  }
  const result = await create();
  const status = result.status ?? 200;
  idempotencyRecords.set(scope, {
    requestHash: hash,
    response: result.body,
    status,
  });
  return HttpResponse.json(result.body as never, { status });
}

function validationError(message: string): { code: "VALIDATION_FAILED"; message: string; traceId: string } {
  return {
    code: "VALIDATION_FAILED",
    message,
    traceId: `trace_${Date.now()}`,
  };
}

function readLLMAssistRequest(body: unknown): { nodeId?: string } {
  if (typeof body !== "object" || body === null || !("nodeId" in body)) {
    return {};
  }
  const nodeId = (body as { nodeId?: unknown }).nodeId;
  return typeof nodeId === "string" ? { nodeId } : {};
}

function apiErrorBody(code: Parameters<typeof errorJson>[0], message: string, details?: unknown): { code: Parameters<typeof errorJson>[0]; message: string; details?: unknown; traceId: string } {
  return {
    code,
    message,
    details,
    traceId: `trace_${Date.now()}`,
  };
}

function parseAuditEventQuery(search: URLSearchParams): AuditEventQuery {
  const query: AuditEventQuery = {};
  setOptionalQueryValue(search, query, "taskId");
  setOptionalQueryValue(search, query, "entityId");
  setOptionalQueryValue(search, query, "schemaVersionId");
  setOptionalQueryValue(search, query, "assignmentId");
  setOptionalQueryValue(search, query, "submissionId");
  setOptionalQueryValue(search, query, "reviewId");
  setOptionalQueryValue(search, query, "exportId");
  setOptionalQueryValue(search, query, "migrationPlanId");
  setOptionalQueryValue(search, query, "actorId");
  setOptionalQueryValue(search, query, "createdFrom");
  setOptionalQueryValue(search, query, "createdTo");

  const entityType = search.get("entityType");
  if (entityType !== null) query.entityType = entityType as AuditTargetEntityType;
  const source = search.get("source");
  if (source !== null) query.source = source as AuditSource;
  const limit = search.get("limit");
  if (limit !== null) {
    const parsed = Number(limit);
    if (Number.isFinite(parsed) && parsed > 0) {
      query.limit = parsed;
    }
  }

  const types = readMultiValueParam(search, "types");
  if (types.length > 0) query.types = types as AuditEventType[];
  const severities = readMultiValueParam(search, "severities");
  if (severities.length > 0) query.severities = severities as AuditSeverity[];

  return query;
}

function setOptionalQueryValue(search: URLSearchParams, query: AuditEventQuery, key: keyof AuditEventQuery): void {
  const value = search.get(key);
  if (value !== null) {
    setAuditQueryStringValue(query, key, value);
  }
}

function setAuditQueryStringValue(query: AuditEventQuery, key: keyof AuditEventQuery, value: string): void {
  switch (key) {
    case "taskId":
    case "entityId":
    case "schemaVersionId":
    case "assignmentId":
    case "submissionId":
    case "reviewId":
    case "exportId":
    case "migrationPlanId":
    case "actorId":
    case "createdFrom":
    case "createdTo":
      query[key] = value;
      return;
    default:
      return;
  }
}

function readMultiValueParam(search: URLSearchParams, key: string): string[] {
  return search
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function handleSaveSchemaDraftRequest(request: Request, params: MockParams): Promise<Response> {
  const taskId = getParam(params, "taskId");
  const body = await readJson<SaveSchemaDraftRequest>(request);
  return withIdempotency(request, body, () => {
    const response = saveSchemaDraft(taskId, body.schema);
    return { body: response };
  });
}

async function handleAppRouteRequest(request: Request): Promise<Response | undefined> {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) {
    return undefined;
  }

  const url = new URL(request.url);
  const response = await fetch(`${url.origin}/`);
  const html = await response.text();
  return new HttpResponse(html, {
    status: response.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

function demoActorForEmail(email: string): { id: string; role: "OWNER" | "LABELER" | "REVIEWER"; displayName: string } | undefined {
  switch (email) {
    case "owner@labelhub.test":
    case "owner@labelhub.com":
      return { id: "usr_owner", role: "OWNER", displayName: "任务负责人" };
    case "labeler@labelhub.test":
    case "labeler@labelhub.com":
      return { id: "usr_labeler", role: "LABELER", displayName: "标注员" };
    case "reviewer@labelhub.test":
    case "reviewer@labelhub.com":
      return { id: "usr_reviewer", role: "REVIEWER", displayName: "审核员" };
    default:
      return undefined;
  }
}
