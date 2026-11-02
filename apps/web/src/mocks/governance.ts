import { http } from "msw/http";
import type { Actor, CreateMigrationJobRequest, CreateTaskPermissionRequest, ID, MigrationJob, MigrationRecord, TaskPermission, TaskPermissionGrant } from "@labelhub/contracts";
import { TASK_PERMISSIONS } from "@labelhub/contracts";
import { previewMigrationBatch, stableStringify } from "@labelhub/schema-core";
import type { MigrationBatchInput } from "@labelhub/schema-core";
import { mockDb } from "./mock-db/state";
import { errorJson, okJson } from "./mock-utils";
import { hashCanonicalJson } from "./hash-utils";

type StoredJob = { job: MigrationJob; request: CreateMigrationJobRequest; input?: MigrationBatchInput; preview?: ReturnType<typeof previewMigrationBatch>; sources?: Record<string, string>; records: MigrationRecord[] };
type State = { jobs: StoredJob[]; grants: TaskPermissionGrant[] };
const key = "labelhub_demo_governance_v1";
const state = (): State => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as State : { jobs: [], grants: [] }; } catch { return { jobs: [], grants: [] }; } };
const save = (value: State) => localStorage.setItem(key, JSON.stringify(value));
const id = (prefix: "job" | "cfg" | "sub"): ID => `${prefix}_${crypto.randomUUID()}`;
function actorFor(request: Request): Actor | undefined {
  const role = request.headers.get("Authorization")?.replace("Bearer mock_token_", "").toUpperCase();
  if (role !== "OWNER" && role !== "REVIEWER" && role !== "LABELER") return undefined;
  return { id: `usr_${role.toLowerCase()}`, role, displayName: role };
}
function allowed(store: State, actor: Actor, taskId: string, action: TaskPermission): boolean {
  const task = mockDb.tasks.find((entry) => entry.id === taskId);
  if (!task) return false;
  if (action === "permissions.manage") return task.ownerId === actor.id;
  const grants = store.grants.filter((grant) => grant.taskId === taskId && grant.userId === actor.id && grant.action === action && !grant.revokedAt && (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.now()));
  if (grants.some((grant) => grant.effect === "DENY")) return false;
  return grants.some((grant) => grant.effect === "ALLOW") || task.ownerId === actor.id || action === "task.read" || (action === "review.work" && actor.role === "REVIEWER") || (action === "labeling.work" && actor.role === "LABELER");
}
async function checksum(value: unknown): Promise<string> { const result = await hashCanonicalJson(value); if (!result) throw new Error("当前环境无法计算 SHA-256"); return result; }
function page<T>(items: T[], url: URL) { const number = Math.max(1, Number(url.searchParams.get("page")) || 1), size = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 20)); return { items: items.slice((number - 1) * size, number * size), total: items.length, page: number, pageSize: size }; }
export const governanceHandlers = [
  http.get("*/api/v1/governance/tasks", ({ request }) => {
    const actor = actorFor(request); if (!actor) return errorJson("PERMISSION_DENIED", "请登录", 401);
    const store = state(); return okJson({ items: mockDb.tasks.filter((task) => allowed(store, actor, task.id, "migration.read") || allowed(store, actor, task.id, "permissions.manage")) });
  }),
  http.get("*/api/v1/tasks/:taskId/migration-candidates", ({ request, params }) => {
    const actor = actorFor(request), taskId = String(params.taskId), url = new URL(request.url);
    if (!actor || !allowed(state(), actor, taskId, "migration.read")) return errorJson("PERMISSION_DENIED", "无读取权限", 403);
    return okJson(page(mockDb.submissions.filter((sub) => sub.taskId === taskId && sub.schemaVersionId === url.searchParams.get("schemaVersionId")).map((sub) => ({ id: sub.id, schemaVersionId: sub.schemaVersionId, labelerId: sub.labelerId, status: sub.status, createdAt: sub.createdAt })), url));
  }),
  http.all(/\/api\/v1\/tasks\/[^/]+\/(?:migrations|permissions)(?:\/[^?]*)?(?:\?.*)?$/, async ({ request }) => {
    const actor = actorFor(request); if (!actor) return errorJson("PERMISSION_DENIED", "请登录", 401);
    const store = state(), url = new URL(request.url), parts = url.pathname.split("/");
    const index = parts.indexOf("tasks"), taskId = parts[index + 1]!, resource = parts[index + 2], entityId = parts[index + 3], command = parts[index + 4];
    const task = mockDb.tasks.find((entry) => entry.id === taskId); if (!task) return errorJson("RESOURCE_NOT_FOUND", "任务不存在", 404);
    const permits = (action: TaskPermission) => allowed(store, actor, taskId, action);
    const denied = () => errorJson("PERMISSION_DENIED", "没有此任务的操作权限", 403);
    try {
      if (resource === "permissions") {
        if (entityId === "me") return okJson({ taskId, permissions: TASK_PERMISSIONS.filter(permits) });
        if (!permits("permissions.manage")) return denied();
        if (request.method === "GET") return okJson({ grants: store.grants.filter((grant) => grant.taskId === taskId) });
        if (command === "revoke") {
          const grant = store.grants.find((entry) => entry.id === entityId && entry.taskId === taskId);
          if (!grant) return errorJson("RESOURCE_NOT_FOUND", "授权不存在", 404);
          grant.revokedAt ??= new Date().toISOString(); save(store); return okJson(grant);
        }
        const body = await request.json() as CreateTaskPermissionRequest;
        if (!["usr_owner", "usr_reviewer", "usr_labeler"].includes(body.userId) || !body.actions?.length || body.actions.some((action) => !TASK_PERMISSIONS.includes(action) || action === "permissions.manage") || !["ALLOW", "DENY"].includes(body.effect) || (body.expiresAt && !(Date.parse(body.expiresAt) > Date.now()))) return errorJson("VALIDATION_FAILED", "请检查用户、动作与有效期", 422);
        const grants = [...new Set(body.actions)].map((action): TaskPermissionGrant => ({ id: id("cfg"), taskId: task.id, userId: body.userId, action, effect: body.effect, ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}), createdBy: actor.id, createdAt: new Date().toISOString() }));
        store.grants.push(...grants); save(store); return okJson({ grants }, 201);
      }
      if (!permits("migration.read")) return denied();
      if (!entityId && request.method === "GET") return okJson(page(store.jobs.filter((entry) => entry.job.taskId === taskId).map((entry) => entry.job).reverse(), url));
      if (!entityId && request.method === "POST") {
        if (!permits("migration.plan")) return denied();
        const body = await request.json() as CreateMigrationJobRequest;
        const versions = mockDb.schemaVersions.filter((version) => version.taskId === taskId);
        if (body.fromSchemaVersionId === body.toSchemaVersionId || !versions.some((version) => version.id === body.fromSchemaVersionId) || !versions.some((version) => version.id === body.toSchemaVersionId) || !body.submissionIds?.length || body.submissionIds.length > 500 || new Set(body.submissionIds).size !== body.submissionIds.length || body.submissionIds.some((submissionId) => !mockDb.submissions.some((sub) => sub.id === submissionId && sub.taskId === taskId && sub.schemaVersionId === body.fromSchemaVersionId))) return errorJson("VALIDATION_FAILED", "请检查版本与提交范围", 422);
        const now = new Date().toISOString(); const job: MigrationJob = { id: id("job"), taskId: task.id, status: "DRAFT", createdBy: actor.id, createdAt: now, updatedAt: now, fromSchemaVersionId: body.fromSchemaVersionId, toSchemaVersionId: body.toSchemaVersionId, submissionIds: body.submissionIds, completedCount: 0, conflictCount: 0 };
        store.jobs.push({ job, request: body, records: [] }); save(store); return okJson(job, 201);
      }
      const stored = store.jobs.find((entry) => entry.job.id === entityId && entry.job.taskId === taskId);
      if (!stored) return errorJson("RESOURCE_NOT_FOUND", "迁移任务不存在", 404);
      const job = stored.job;
      if (request.method === "GET") return okJson(command === "records" ? page(stored.records, url) : job);
      const permission: TaskPermission = command === "approve" || command === "reject" ? "migration.approve" : command === "execute" || command === "retry" ? "migration.execute" : "migration.plan";
      if (!permits(permission)) return denied();
      const states: Record<string, string[]> = { "dry-run": ["DRAFT", "READY", "BLOCKED"], submit: ["READY"], approve: ["PENDING_APPROVAL"], reject: ["PENDING_APPROVAL"], execute: ["APPROVED"], retry: ["FAILED"], cancel: ["DRAFT", "READY", "BLOCKED", "PENDING_APPROVAL", "APPROVED"] };
      if (!states[command ?? ""]?.includes(job.status)) return errorJson("INVALID_STATE_TRANSITION", "当前状态不允许此操作", 409);
      if (command === "dry-run") {
        const source = mockDb.schemaVersions.find((version) => version.id === job.fromSchemaVersionId)!, target = mockDb.schemaVersions.find((version) => version.id === job.toSchemaVersionId)!;
        const submissions = mockDb.submissions.filter((sub) => job.submissionIds.includes(sub.id));
        const options = stored.request;
        stored.input = { oldSchema: source.snapshot, newSchema: target.snapshot, options, submissions: submissions.map((sub) => ({ submissionId: sub.id, schemaVersionId: sub.schemaVersionId, answers: sub.answers, updatedAt: sub.updatedAt, submittedAt: sub.createdAt })), contexts: Object.fromEntries(submissions.map((sub) => [sub.id, { task: { id: task.id, title: task.title, status: task.status, activeSchemaVersionId: target.id }, schema: { schemaId: target.schemaId, schemaVersionId: target.id, schemaVersionNo: target.schemaVersionNo, contractVersion: "1.1" }, item: { id: sub.itemId, sourcePayload: mockDb.datasetItems.find((item) => item.id === sub.itemId)?.sourcePayload ?? {} }, answers: sub.answers, system: { actor, role: actor.role, now: new Date().toISOString() } }])) };
        stored.preview = previewMigrationBatch(stored.input); stored.sources = Object.fromEntries(submissions.map((sub) => [sub.id, stableStringify(sub)]));
        job.plan = stored.preview.plan; job.report = stored.preview.report; job.checksum = await checksum({ input: stored.input, preview: stored.preview, sources: stored.sources }); job.status = job.report.executable ? "READY" : "BLOCKED";
      } else if (command === "submit") job.status = "PENDING_APPROVAL";
      else if (command === "cancel") job.status = "CANCELED";
      else if (command === "approve" || command === "reject") {
        if (actor.id === job.createdBy) return errorJson("PERMISSION_DENIED", "审批人必须与发起人不同", 403);
        const decision = await request.json() as { checksum: string; reason: string };
        if (!decision.reason?.trim() || decision.reason.length > 500) return errorJson("VALIDATION_FAILED", "请填写审批意见", 422);
        if (decision.checksum !== job.checksum) return errorJson("REVISION_CONFLICT", "审批摘要已过期", 409);
        job.status = command === "approve" ? "APPROVED" : "REJECTED"; job.approvedBy = actor.id; job.approvedAt = new Date().toISOString(); job.decisionReason = decision.reason;
      } else {
        if (job.checksum !== await checksum({ input: stored.input, preview: stored.preview, sources: stored.sources })) return errorJson("REVISION_CONFLICT", "批准内容发生变化", 409);
        for (const entry of stored.preview!.records) {
          const current = mockDb.submissions.find((sub) => sub.id === entry.submissionId);
          const conflict = !current || stableStringify(current) !== stored.sources![entry.submissionId];
          const record: MigrationRecord = { id: id("sub"), jobId: job.id, submissionId: entry.submissionId as ID, fromSchemaVersionId: job.fromSchemaVersionId, toSchemaVersionId: job.toSchemaVersionId, status: conflict ? "CONFLICT" : "SUCCEEDED", sourceHash: await checksum(JSON.parse(stored.sources![entry.submissionId]!)), createdAt: new Date().toISOString() };
          if (conflict) job.conflictCount++; else { job.completedCount++; record.answers = entry.answers; record.archivedAnswers = entry.archivedAnswers; record.resultHash = await checksum(entry); }
          stored.records.push(record);
        }
        job.status = job.conflictCount ? "PARTIAL" : "SUCCEEDED";
      }
      job.updatedAt = new Date().toISOString(); save(store); return okJson(job);
    } catch (error) { return errorJson("VALIDATION_FAILED", error instanceof Error ? error.message : "请求无法处理", 422); }
  }),
];
