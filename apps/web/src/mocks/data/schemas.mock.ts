import type { LabelHubSchema, PublishedLabelHubSchema, SchemaVersion } from "@labelhub/contracts";

export const newsQualitySchemaDraft: LabelHubSchema = {
  contractVersion: "1.1",
  schemaId: "schema_news_quality",
  schemaDraftRevision: 1,
  status: "DRAFT",
  meta: {
    name: "新闻质量标注模板",
    description: "用于对新闻文本进行类别、质量、事实性和修改建议标注",
    taskId: "task_news_quality",
    authorId: "usr_owner",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
  },
  root: {
    id: "root",
    kind: "CONTAINER",
    type: "container.section",
    title: "新闻质量标注",
    children: [
      {
        id: "show_title",
        kind: "SHOW_ITEM",
        type: "show.text",
        title: "新闻标题",
        sourcePath: "$.item.sourcePayload.title",
        transform: { type: "TEXT", fallback: "无标题" },
      },
      {
        id: "show_body",
        kind: "SHOW_ITEM",
        type: "show.text",
        title: "新闻正文",
        sourcePath: "$.item.sourcePayload.body",
        transform: { type: "TEXT", fallback: "无正文" },
      },
      {
        id: "news_category",
        kind: "FIELD",
        type: "choice.radio",
        name: "newsCategory",
        title: "新闻类别",
        required: true,
        options: [
          { label: "时政", value: "politics" },
          { label: "财经", value: "finance" },
          { label: "科技", value: "technology" },
          { label: "社会", value: "society" },
          { label: "其他", value: "other" },
        ],
        validations: [{ type: "required", message: "请选择新闻类别" }],
      },
      {
        id: "quality_score",
        kind: "FIELD",
        type: "choice.select",
        name: "qualityScore",
        title: "质量评分",
        required: true,
        options: [
          { label: "1", value: "1" },
          { label: "2", value: "2" },
          { label: "3", value: "3" },
          { label: "4", value: "4" },
          { label: "5", value: "5" },
        ],
        validations: [{ type: "required", message: "请选择质量评分" }],
        linkageRules: [
          {
            id: "R-low-quality-requires-note",
            when: {
              op: "in",
              left: { kind: "path", path: "$.answers.qualityScore" },
              right: [
                { kind: "literal", value: "1" },
                { kind: "literal", value: "2" },
              ],
            },
            effects: [
              { action: "setVisible", target: "factCheckNote", value: true },
              { action: "setRequired", target: "factCheckNote", value: true },
            ],
            otherwise: [
              { action: "setVisible", target: "factCheckNote", value: false },
              { action: "setRequired", target: "factCheckNote", value: false },
              { action: "clearValue", target: "factCheckNote" },
            ],
          },
        ],
      },
      {
        id: "issue_tags",
        kind: "FIELD",
        type: "choice.tags",
        name: "issueTags",
        title: "问题标签",
        options: [
          { label: "标题党", value: "clickbait" },
          { label: "事实不清", value: "unclear_fact" },
          { label: "缺少来源", value: "missing_source" },
          { label: "格式问题", value: "format_issue" },
          { label: "无明显问题", value: "no_issue" },
        ],
      },
      {
        id: "fact_check_note",
        kind: "FIELD",
        type: "input.textarea",
        name: "factCheckNote",
        title: "事实核查说明",
        placeholder: "请说明事实性问题、证据来源或判断依据",
        preserveWhenHidden: true,
      },
      {
        id: "rewrite_suggestion",
        kind: "FIELD",
        type: "input.textarea",
        name: "rewriteSuggestion",
        title: "修改建议",
        placeholder: "请给出可执行的修改建议",
        preserveWhenHidden: true,
      },
      {
        id: "ai_quality_helper",
        kind: "LLM_ASSIST",
        type: "llm.assist",
        title: "AI 质量检查建议",
        trigger: "MANUAL",
        promptTemplate: "请根据新闻标题、正文和当前标注结果，给出质量检查建议。",
        inputBindings: {
          title: "$.item.sourcePayload.title",
          body: "$.item.sourcePayload.body",
          category: "$.answers.newsCategory",
          score: "$.answers.qualityScore",
          issueTags: "$.answers.issueTags",
        },
        outputMode: "SUGGESTION",
        outputBindings: [
          {
            from: "$.output.summary",
            toFieldName: "rewriteSuggestion",
            mode: "APPEND",
            requireUserConfirm: true,
          },
        ],
        rateLimit: {
          maxCallsPerAssignment: 3,
        },
      },
    ],
  },
};

export const newsQualityPublishedSchema: PublishedLabelHubSchema = {
  ...newsQualitySchemaDraft,
  schemaVersionId: "sv_news_quality_1",
  schemaVersionNo: 1,
  status: "PUBLISHED",
  meta: {
    ...newsQualitySchemaDraft.meta,
    publishedAt: "2026-05-24T00:00:00.000Z",
  },
};

export const schemaVersionsMock: SchemaVersion[] = [
  {
    id: "sv_news_quality_1",
    schemaId: "schema_news_quality",
    taskId: "task_news_quality",
    schemaVersionNo: 1,
    contractVersion: "1.1",
    snapshot: newsQualityPublishedSchema,
    createdAt: "2026-05-24T00:00:00.000Z",
  },
];
