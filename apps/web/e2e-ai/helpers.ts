import { createHash, randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import type {
  Actor, AssignmentContextResponse, ClaimTaskResponse, CreateUploadUrlResponse, ID,
  ImportDatasetResponse, LabelHubSchema, PublishSchemaVersionResponse, ReviewDetailResponse,
  ReviewDimension, Role, SaveSchemaDraftResponse, SubmitAssignmentResponse, Task,
} from "@labelhub/contracts";

export const suggestion = "受控建议：材料完整且标注清晰。";
export const source = { text: "合成验收材料：甲城市季度销量为 120 台。", source: "测试夹具，无真实用户数据" };
export const dimensions: ReviewDimension[] = [{ key: "correctness", label: "标注正确性", description: "标注必须符合材料", weight: 1, scoreRange: [0, 100] }];
type Auth = { token: string; actor: Actor };
export type Receipt = { kind: "assist" | "review"; mode: string; envelope: Record<string, unknown> };

export class Workflow {
  private auth = new Map<Role, Auth>();
  constructor(readonly request: APIRequestContext) {}

  async login() {
    for (const role of ["OWNER", "LABELER", "REVIEWER"] as const) {
      this.auth.set(role, await this.call<Auth>(role, "/auth/login", { email: `${role.toLowerCase()}@labelhub.com`, password: "password123" }));
    }
  }

  async call<T>(role: Role, path: string, data?: unknown, method = data === undefined ? "GET" : "POST"): Promise<T> {
    const auth = this.auth.get(role);
    const response = await this.request.fetch(`/api/v1${path}`, { method, data, headers: auth ? { Authorization: `Bearer ${auth.token}` } : {} });
    expect(response.ok(), `${method} ${path} 返回 ${response.status()}`).toBeTruthy();
    return await response.json() as T;
  }

  async control(data?: Record<string, unknown>): Promise<{ runId: string; requests: Receipt[] }> {
    const response = await this.request.fetch(`${process.env.CONTROLLED_MODEL_URL}/control`, {
      method: data ? "POST" : "GET", data,
      headers: { "X-Control-Token": process.env.CONTROLLED_MODEL_TOKEN! },
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json() as { runId: string; requests: Receipt[] };
    expect(result.runId).toBe(process.env.CONTROLLED_AI_RUN_ID);
    return result;
  }

  async createTask(mode = "HUMAN_REVIEW_ONLY", reviewEnabled = true) {
    const title = `受控链路 ${randomUUID()}`;
    const { task } = await this.call<{ task: Task }>("OWNER", "/tasks", {
      title, description: "仅核查合成材料中的标注，不评价材料质量。", quota: { total: 10 },
      distributionStrategy: { type: "FIRST_COME_FIRST_SERVED" }, reviewPolicy: { type: "SINGLE_REVIEW" },
    });
    const now = new Date().toISOString();
    const schema: LabelHubSchema = {
      contractVersion: "1.1", schemaId: `schema_controlled_${randomUUID()}`, status: "DRAFT",
      meta: { name: title, taskId: task.id, authorId: this.auth.get("OWNER")!.actor.id, createdAt: now, updatedAt: now },
      root: { id: "root", kind: "CONTAINER", type: "container.group", title: "标注", children: [
        { id: "summary", kind: "FIELD", type: "input.text", name: "summary", title: "摘要" },
        { id: "assist", kind: "LLM_ASSIST", type: "llm.assist", title: "辅助建议", trigger: "MANUAL",
          promptTemplate: "依据材料生成摘要", modelPolicyId: "controlled", inputBindings: { material: "$.item.sourcePayload.text" }, outputMode: "SUGGESTION",
          outputBindings: [{ toFieldName: "summary", from: "$", mode: "REPLACE", requireUserConfirm: true }] },
      ] },
    };
    const draft = await this.call<SaveSchemaDraftResponse>("OWNER", `/tasks/${task.id}/schema/draft`, { schema }, "PUT");
    const version = await this.call<PublishSchemaVersionResponse>("OWNER", `/tasks/${task.id}/schema/publish`, { schemaDraftRevision: draft.schemaDraftRevision });
    const raw = Buffer.from(JSON.stringify([source]));
    const upload = await this.call<CreateUploadUrlResponse>("OWNER", "/files/upload-url", {
      fileName: "controlled.json", mimeType: "application/json", size: raw.length, purpose: "DATASET_IMPORT",
      ownerType: "USER", ownerId: this.auth.get("OWNER")!.actor.id,
    });
    const uploaded = await this.request.post(`/api/v1/files/${upload.file.id}/upload`, { data: raw,
      headers: { Authorization: `Bearer ${this.auth.get("OWNER")!.token}`, "Content-Type": "application/json" } });
    expect(uploaded.ok()).toBeTruthy();
    await this.call("OWNER", `/files/${upload.file.id}/confirm`, { checksum: createHash("sha256").update(raw).digest("hex") });
    expect((await this.call<ImportDatasetResponse>("OWNER", `/tasks/${task.id}/dataset/import`, { fileId: upload.file.id, format: "JSON" })).importedCount).toBe(1);
    await this.call("OWNER", `/tasks/${task.id}/review-config`, {
      enabled: reviewEnabled, modelPolicyId: "controlled", promptTemplate: "核查标注答案与材料是否一致", dimensions,
      thresholds: { passScore: .8, returnScore: .45 }, conclusionMapping: { mode }, maxRetries: 1,
    });
    await this.call("OWNER", `/tasks/${task.id}/publish`, { schemaVersionId: version.schemaVersion.id, reviewDisabledExplicitly: !reviewEnabled });
    const { context } = await this.call<ClaimTaskResponse>("LABELER", `/tasks/${task.id}/claim`, {});
    return { task, assignment: context.assignment.id, schemaVersionId: version.schemaVersion.id };
  }

  context(id: ID) { return this.call<AssignmentContextResponse>("LABELER", `/assignments/${id}`); }
  detail(id: ID) { return this.call<ReviewDetailResponse>("REVIEWER", `/review/submissions/${id}`); }
  submit(id: ID, summary: string) { return this.call<SubmitAssignmentResponse>("LABELER", `/assignments/${id}/submit`, { answers: { summary } }); }

  async settled(id: ID, expected: ReviewDetailResponse["submission"]["status"]) {
    await expect.poll(async () => (await this.detail(id)).submission.status, { timeout: 40_000 }).toBe(expected);
    return this.detail(id);
  }

  async page(browser: Browser, role: Role, errors: string[]): Promise<Page> {
    const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL });
    await context.addInitScript(({ auth, role }) => {
      localStorage.setItem("labelhub_token", auth.token);
      localStorage.setItem("labelhub_actor", JSON.stringify(auth.actor));
      localStorage.setItem("labelhub_role", role);
    }, { auth: this.auth.get(role)!, role });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => errors.push(error.message));
    return page;
  }
}
