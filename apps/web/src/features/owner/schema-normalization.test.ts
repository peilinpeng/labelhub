import { describe, expect, it } from "vitest";
import type { DatasetItem, FieldNode, ID, LabelHubSchema, Task } from "@labelhub/contracts";
import { mockDb } from "../../mocks/mock-db";
import * as schemaModel from "./schema-normalization";

function baseSchema(): LabelHubSchema {
  return structuredClone(mockDb.schemaDrafts.find((item) => item.meta.taskId === "task_news_quality")!);
}

function baseTask(): Task {
  return structuredClone(mockDb.tasks.find((item) => item.id === "task_news_quality")!);
}

describe("schema-normalization", () => {
  it("生成人类可读的状态与字段文案", () => {
    const schema = baseSchema();
    expect(schemaModel.schemaRevisionLabel(schema)).toMatch(/^r\d+$/);
    expect((["success", "danger", "warning", "info"] as const).map(schemaModel.noticeBadgeTone))
      .toEqual(["success", "danger", "warning", "primary"]);
    expect(schemaModel.humanizeGeneratedNodeTitle("show_model_response")).toBe("模型回答内容");
    expect(schemaModel.humanizeGeneratedNodeTitle("quality_score")).toBe("quality 打分");
    expect(schemaModel.humanizeGeneratedNodeTitle("自然语言标题")).toBe("自然语言标题");
    expect(schemaModel.friendlyFieldTitle("prompt")).toBe("用户问题");
    expect(schemaModel.friendlyFieldTitle("custom")).toBe("custom");
  });

  it("按分发策略判断发布就绪状态", () => {
    const task = baseTask();
    expect(schemaModel.isDistributionReady(task)).toBe(true);
    expect(schemaModel.isDistributionReady({ ...task, title: "" })).toBe(false);
    expect(schemaModel.isDistributionReady({
      ...task,
      distributionStrategy: { type: "ASSIGNMENT", assigneeIds: [] },
    })).toBe(false);
    expect(schemaModel.isDistributionReady({
      ...task,
      distributionStrategy: { type: "QUOTA_CLAIM", claimBatchSize: 0 },
    })).toBe(false);
  });

  it("发现空模板、任务绑定、草稿版本和字段配置问题", () => {
    const schema = baseSchema();
    const invalid: LabelHubSchema = {
      ...schema,
      schemaDraftRevision: 0,
      meta: { ...schema.meta, name: "", taskId: "another_task" as ID },
      root: {
        ...schema.root,
        children: [{
          id: "choice_bad" as ID,
          kind: "FIELD",
          type: "choice.radio",
          name: "",
          title: "",
          required: true,
          options: [{ label: "", value: "" }],
        }],
      },
    };
    const issues = schemaModel.collectPublishConfigurationIssues(invalid, "task_news_quality");
    expect(issues.map((issue) => issue.badge)).toEqual(expect.arrayContaining([
      "模板名称未完成", "任务绑定异常", "草稿版本缺失", "缺少组件名称", "缺少字段名", "缺少选项",
    ]));
    expect(schemaModel.createPublishValidationResult(invalid, issues).valid).toBe(false);
  });

  it("把发布失败转换为可执行的人话提示", () => {
    expect(schemaModel.getPublishFailureMessage(new Error("409 conflict"), "SAVE_DRAFT")).toContain("已被更新");
    expect(schemaModel.getPublishFailureMessage(new Error("Failed to fetch"), "PUBLISH_SCHEMA")).toContain("接口暂不可用");
    expect(schemaModel.getPublishFailureMessage(new Error("数据集没有可领取题目"), "PUBLISH_TASK")).toContain("数据");
    expect(schemaModel.getPublishFailureMessage(new Error("AI 预审尚未配置"), "PUBLISH_TASK")).toContain("AI 预审");
    expect(schemaModel.getPublishFailureMessage(new Error("422 校验失败"), "PUBLISH_SCHEMA")).toContain("完成标注模板配置");
    expect(schemaModel.getPublishFailureSuggestions(new Error("409 conflict"), "SAVE_DRAFT")).toHaveLength(2);
    expect(schemaModel.getPublishFailureSuggestions(new Error("数据集"), "PUBLISH_TASK")[0]).toContain("数据集管理页");
    expect(schemaModel.getPublishFailureSuggestions(new Error("ReviewConfig"), "PUBLISH_TASK")[0]).toContain("AI 预审");
  });

  it("规范化 AI 生成草稿、真实展示字段与重复标识", () => {
    const schema = baseSchema();
    const generated = schemaModel.normalizeGeneratedSchemaDraft({
      title: "AI 质检",
      nodes: [
        { id: "show_model_response", type: "show.text", title: "show_model_response" },
        { id: "score", name: "score", type: "choice.radio", title: "quality_score", options: ["好", "差"] },
        { id: "score", name: "score", type: "unknown.type", label: "补充说明" },
        { id: "group", type: "container.group", children: [{ id: "child", type: "input.text" }] },
      ],
    }, schema, schema.meta.taskId, "任务", "生成质检模板", ["model_response"]);
    expect(generated.root.children).toHaveLength(4);
    expect(generated.root.children[0]).toMatchObject({
      title: "模型回答内容",
      sourcePath: "$.item.sourcePayload.model_response",
    });
    expect(generated.root.children[1]).toMatchObject({ name: "score" });
    expect("options" in generated.root.children[1] ? generated.root.children[1].options[0] : undefined)
      .toEqual({ label: "好", value: "好" });
    expect(generated.root.children[2]).toMatchObject({ id: "score_2", name: "score_2", type: "input.textarea" });
    expect(new Set(generated.root.children.map((node) => node.id)).size).toBe(4);
    expect(schemaModel.collectSelectableNodeSummaries(generated)).toHaveLength(4);
    expect(schemaModel.buildSelectedSchemaDraft(generated, new Set(["score"])).root.children).toHaveLength(1);
  });

  it("处理生成节点的选项、标识、展示路径和错误文本", () => {
    expect(schemaModel.normalizeGeneratedNodeType(undefined)).toBe("input.textarea");
    expect(schemaModel.normalizeGeneratedOptions(undefined)).toHaveLength(2);
    expect(schemaModel.normalizeGeneratedOptions([{ text: "通过" }, 2])).toEqual([
      { label: "通过", value: "通过" },
      { label: "2", value: "2" },
    ]);
    expect(schemaModel.sanitizeIdentifier(" !! ", "fallback")).toBe("fallback");
    expect(schemaModel.uniqueValue("field", new Set(["field", "field_2"]))).toBe("field_3");
    expect(schemaModel.inferGeneratedShowSourcePath({ sourcePath: "$.item.sourcePayload.prompt" }, "x", ["prompt"]))
      .toBe("$.item.sourcePayload.prompt");
    expect(schemaModel.formatSchemaIssue({ message: "错误", path: "$.root" })).toBe("错误（$.root）");
    expect(schemaModel.formatSchemaIssue(null)).toBe("未命名问题");
    expect(schemaModel.isAnswerFieldType("choice.radio")).toBe(true);
    expect(schemaModel.isAnswerFieldType("show.text")).toBe(false);
  });

  it("创建和更新条件/校验规则", () => {
    const fields = schemaModel.collectDataFields([]) as unknown as FieldNode[];
    expect(schemaModel.createConditionRule(fields).targetField).toBe("");
    expect(schemaModel.createValidationRule(fields)).toMatchObject({ type: "required", message: "请完成该字段" });
    const fieldNodes = baseSchema().root.children.filter((node): node is FieldNode => node.kind === "FIELD");
    expect(schemaModel.createConditionRule(fieldNodes).conditionField).toBe(fieldNodes[0]?.name ?? "");
  });

  it("维护新闻模板必需字段并支持预设绑定", () => {
    const schema = baseSchema();
    const withoutRewrite = {
      ...schema,
      root: { ...schema.root, children: schema.root.children.filter((node) => node.kind !== "FIELD" || node.name !== "rewriteSuggestion") },
    };
    const repaired = schemaModel.ensureNewsQualityPreviewFields(withoutRewrite);
    expect(repaired.root.children.some((node) => node.kind === "FIELD" && node.name === "rewriteSuggestion")).toBe(true);
    const blank = schemaModel.createBlankSchema(schema.meta.taskId);
    const bound = schemaModel.bindPresetToCurrentDraft(blank, schema, schema.meta.taskId, "新闻任务");
    expect(bound.schemaId).toBe(schema.schemaId);
    expect(bound.meta.taskId).toBe(schema.meta.taskId);
    expect(schemaModel.summarizeSchemaFields(repaired)).not.toBe("空白模板");
    expect(schemaModel.presetIdForTask("task_news_quality")).toBe("news_quality");
    expect(schemaModel.presetIdForSchema(schema)).toBe("news_quality");
  });

  it("持久化自定义预设时限制最近 12 个", () => {
    const schema = baseSchema();
    const presets = Array.from({ length: 14 }, (_, index) => ({
      id: `preset_${index}`,
      title: `预设 ${index}`,
      description: "",
      fields: "",
      schema,
      createdAt: new Date().toISOString(),
    }));
    schemaModel.writeCustomSchemaPresets(presets);
    expect(schemaModel.readCustomSchemaPresets()).toHaveLength(12);
    localStorage.setItem("labelhub.owner.schema-presets.v1", "not-json");
    expect(schemaModel.readCustomSchemaPresets()).toEqual([]);
  });

  it("构造预览上下文并安全读取发布响应", () => {
    const schema = baseSchema();
    const task = baseTask();
    const context = schemaModel.createSampleContext(schema, task, "OWNER");
    expect(context.task.id).toBe(task.id);
    expect(context.system.role).toBe("OWNER");
    expect(schemaModel.resolveTaskId(undefined, task.id)).toBe(task.id);
    expect(schemaModel.readPublishedSchemaVersionId({ id: "sv_new" }, undefined)).toBe("sv_new");
    expect(schemaModel.readPublishedSchemaVersionNo({ snapshot: { schemaVersionNo: 7 } }, undefined)).toBe(7);
    expect(() => schemaModel.readPublishedSchemaVersionId({}, undefined)).toThrow();
    expect(schemaModel.readSchemaVersionSnapshot({ schema })).toEqual(schema);
    expect(schemaModel.readSchemaVersionSnapshot(null)).toBeUndefined();
  });

  it("追加节点与数据字段时保持 id/name 唯一", () => {
    const schema = baseSchema();
    const first = schemaModel.appendNodeToRoot(schema, "input.text");
    const second = schemaModel.appendNodeToRoot(first, "input.text");
    const added = second.root.children.slice(-2) as FieldNode[];
    expect(added[0].id).not.toBe(added[1].id);
    expect(added[0].name).not.toBe(added[1].name);
    const shown = schemaModel.appendShowItemField(schema, "prompt");
    expect(shown.root.children.at(-1)).toMatchObject({
      title: "用户问题",
      sourcePath: "$.item.sourcePayload.prompt",
    });
  });

  it("归类并格式化导入数据字段，优先防止答案泄露", () => {
    expect(schemaModel.classifyFieldRole("ground_truth")).toBe("answer");
    expect(schemaModel.classifyFieldRole("prompt")).toBe("recommended");
    expect(schemaModel.classifyFieldRole("created_at")).toBe("metadata");
    expect(schemaModel.classifyFieldRole("misc")).toBe("other");
    expect(schemaModel.inferDataFieldKind("https://example.com")).toBe("链接");
    expect(schemaModel.inferDataFieldKind([])).toBe("空值");
    expect(schemaModel.inferDataFieldKind({ ok: true })).toBe("对象");
    expect(schemaModel.formatDataFieldSample("x".repeat(90))).toHaveLength(81);
    const items = [
      { sourcePayload: { prompt: "", score: 0, ground_truth: "yes" } },
      { sourcePayload: { prompt: "请判断", tags: ["a"] } },
    ] as unknown as DatasetItem[];
    expect(schemaModel.collectDataFields(items)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "prompt", sample: "请判断", role: "recommended" }),
      expect.objectContaining({ name: "ground_truth", role: "answer" }),
    ]));
  });

  it("生成发布预览并映射审计载荷", async () => {
    const schema = baseSchema();
    const task = baseTask();
    const preview = await schemaModel.buildPublishPreview({
      schema,
      task,
      schemaValidation: { valid: true, errors: [], warnings: [] },
    });
    expect(preview.publishAllowed).toBe(true);
    expect(preview.affectedSubmissionsLabel).toBe("后端统计暂未接入");
    expect(schemaModel.createOwnerPublishAuditPreview(schema, task, preview)).toMatchObject({
      publishAllowed: true,
      schema,
      task,
    });
  });
});
