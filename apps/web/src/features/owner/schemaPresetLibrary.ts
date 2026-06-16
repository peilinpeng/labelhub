import type { ID, LabelHubSchema, SchemaNode } from "@labelhub/contracts";

export interface SchemaPresetSummary {
  id: string;
  title: string;
  description: string;
  fields: string;
}

export const schemaPresetSummaries: SchemaPresetSummary[] = [
  {
    id: "news_quality",
    title: "新闻质量标注",
    description: "适合新闻标题、正文质量、类别与事实性判断。",
    fields: "标题 / 正文 / 质量判断 / 摘要建议",
  },
  {
    id: "product_title",
    title: "商品标题清洗",
    description: "适合电商标题规范化、关键词抽取与可售卖性审核。",
    fields: "商品标题 / 类目 / 关键词 / 修改建议",
  },
  {
    id: "content_safety",
    title: "内容安全审核",
    description: "适合文本风险识别、违规类型选择与处置建议。",
    fields: "原文 / 风险等级 / 违规标签 / 审核意见",
  },
  {
    id: "image_text_review",
    title: "图文质检",
    description: "适合图片素材、OCR 文本和图文一致性复核。",
    fields: "图片 / OCR / 一致性 / 质检结论",
  },
];

export function createSchemaFromPreset(presetId: string, taskId: ID, taskTitle: string): LabelHubSchema {
  const preset = schemaPresetSummaries.find((item) => item.id === presetId) ?? schemaPresetSummaries[0];
  return createSchema(taskId, `${preset.title}模板`, `${taskTitle} - ${preset.description}`, nodesByPreset(preset.id));
}

function createSchema(taskId: ID, name: string, description: string, children: SchemaNode[]): LabelHubSchema {
  const now = new Date().toISOString();
  return {
    contractVersion: "1.1",
    schemaId: `schema_${taskId}_${Date.now()}` as ID,
    schemaDraftRevision: 1,
    status: "DRAFT",
    meta: {
      name,
      description,
      taskId,
      authorId: "usr_owner" as ID,
      createdAt: now,
      updatedAt: now,
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.section",
      title: name.replace(/模板$/, ""),
      children,
    },
  };
}

function nodesByPreset(presetId: string): SchemaNode[] {
  if (presetId === "product_title") {
    return [
      showText("show_product_title", "商品标题", "$.item.sourcePayload.title", "无商品标题"),
      fieldSelect("product_category", "productCategory", "商品类目", [
        ["服饰鞋包", "fashion"],
        ["数码家电", "electronics"],
        ["食品生鲜", "food"],
        ["家居日用", "home"],
      ]),
      fieldTags("selling_points", "sellingPoints", "卖点关键词", [
        ["品牌", "brand"],
        ["材质", "material"],
        ["规格", "spec"],
        ["场景", "scenario"],
      ]),
      fieldRadio("title_quality", "titleQuality", "标题质量", [
        ["可直接使用", "pass"],
        ["需要修改", "needs_revision"],
        ["不可使用", "rejected"],
      ]),
      fieldTextarea("rewrite_suggestion", "rewriteSuggestion", "修改建议", true),
      llmAssist("ai_title_helper", "AI 标题建议", "根据商品标题、类目和关键词生成清洗建议。", "rewriteSuggestion"),
    ];
  }

  if (presetId === "content_safety") {
    return [
      showText("show_content_text", "待审核文本", "$.item.sourcePayload.body", "无文本内容"),
      fieldRadio("risk_level", "riskLevel", "风险等级", [
        ["安全", "safe"],
        ["低风险", "low"],
        ["中风险", "medium"],
        ["高风险", "high"],
      ]),
      fieldTags("violation_tags", "violationTags", "违规标签", [
        ["涉政", "political"],
        ["辱骂", "abuse"],
        ["色情", "sexual"],
        ["广告", "spam"],
      ]),
      fieldTextarea("review_comment", "reviewComment", "审核意见", true),
      llmAssist("ai_safety_helper", "AI 风险解释", "解释文本风险点并生成审核建议。", "reviewComment"),
    ];
  }

  if (presetId === "image_text_review") {
    return [
      {
        id: "show_image",
        kind: "SHOW_ITEM",
        type: "show.image",
        title: "图片素材",
        sourcePath: "$.item.sourcePayload.image",
        transform: { type: "IMAGE_PREVIEW" },
      },
      showText("show_ocr_text", "OCR 文本", "$.item.sourcePayload.body", "无 OCR 文本"),
      fieldRadio("image_text_match", "imageTextMatch", "图文一致性", [
        ["一致", "match"],
        ["部分一致", "partial"],
        ["不一致", "mismatch"],
      ]),
      fieldTags("quality_tags", "qualityTags", "质检标签", [
        ["清晰度不足", "blur"],
        ["文字缺失", "missing_text"],
        ["内容遮挡", "blocked"],
        ["疑似违规", "risk"],
      ]),
      fieldTextarea("qualityConclusion", "qualityConclusion", "质检结论", true),
    ];
  }

  return [
    showText("show_news_title", "新闻标题", "$.item.sourcePayload.title", "无标题"),
    showText("show_news_body", "新闻正文", "$.item.sourcePayload.body", "无正文"),
    fieldRadio("quality_rating", "qualityRating", "质量判断", [
      ["通过", "pass"],
      ["需要修改", "needs_revision"],
      ["不可用", "rejected"],
    ]),
    fieldTextarea("summary", "summary", "新闻摘要", true),
    fieldTextarea("rewrite_suggestion", "rewriteSuggestion", "修改建议", true),
    llmAssist("ai_summary_helper", "AI 摘要建议", "根据新闻标题和正文生成摘要建议。", "summary"),
  ];
}

function showText(id: string, title: string, sourcePath: string, fallback: string): SchemaNode {
  return {
    id,
    kind: "SHOW_ITEM",
    type: "show.text",
    title,
    sourcePath,
    transform: { type: "TEXT", fallback },
  };
}

function fieldRadio(id: string, name: string, title: string, options: Array<[string, string]>): SchemaNode {
  return {
    id,
    kind: "FIELD",
    type: "choice.radio",
    name,
    title,
    required: true,
    options: options.map(([label, value]) => ({ label, value })),
    validations: [{ type: "required", message: `请选择${title}` }],
  };
}

function fieldSelect(id: string, name: string, title: string, options: Array<[string, string]>): SchemaNode {
  return {
    id,
    kind: "FIELD",
    type: "choice.select",
    name,
    title,
    required: true,
    options: options.map(([label, value]) => ({ label, value })),
    validations: [{ type: "required", message: `请选择${title}` }],
  };
}

function fieldTags(id: string, name: string, title: string, options: Array<[string, string]>): SchemaNode {
  return {
    id,
    kind: "FIELD",
    type: "choice.tags",
    name,
    title,
    multiple: true,
    options: options.map(([label, value]) => ({ label, value })),
  };
}

function fieldTextarea(id: string, name: string, title: string, required: boolean): SchemaNode {
  return {
    id,
    kind: "FIELD",
    type: "input.textarea",
    name,
    title,
    required,
    minRows: 3,
    validations: required ? [{ type: "required", message: `请填写${title}` }] : undefined,
  };
}

function llmAssist(id: string, title: string, promptTemplate: string, toFieldName: string): SchemaNode {
  return {
    id,
    kind: "LLM_ASSIST",
    type: "llm.assist",
    title,
    trigger: "MANUAL",
    promptTemplate,
    inputBindings: {
      title: "$.item.sourcePayload.title",
      body: "$.item.sourcePayload.body",
    },
    outputMode: "SUGGESTION",
    outputBindings: [
      {
        from: "$.output.summary",
        toFieldName,
        mode: "REPLACE",
        requireUserConfirm: true,
      },
    ],
    rateLimit: {
      maxCallsPerAssignment: 3,
    },
  };
}
