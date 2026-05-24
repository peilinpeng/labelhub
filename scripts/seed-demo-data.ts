import type { DatasetItem, LabelHubSchema, Task } from "../packages/contracts/src";

const demoTask: Task = {
  id: "task_news_quality",
  title: "新闻质量标注",
  description: "对新闻标题和正文进行质量、类别和事实性标注。",
  instructionRichText: {
    type: "doc",
    content: [],
  },
  tags: ["新闻", "质量评估", "文本标注"],
  rewardRule: {
    unit: "PER_ACCEPTED_ITEM",
    amount: 1,
    currency: "CNY",
  },
  quota: {
    total: 100,
    perLabeler: 20,
  },
  deadlineAt: "2026-06-30T23:59:59.000Z",
  distributionStrategy: {
    type: "FIRST_COME_FIRST_SERVED",
  },
  reviewPolicy: {
    type: "SINGLE_REVIEW",
  },
  status: "DRAFT",
  activeSchemaVersionId: "sv_news_quality_1",
  ownerId: "usr_owner",
  createdAt: "2026-05-24T00:00:00.000Z",
  updatedAt: "2026-05-24T00:00:00.000Z",
};

const demoSchemaDraft: LabelHubSchema = {
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
        ],
        validations: [{ type: "required", message: "请选择新闻类别" }],
      },
    ],
  },
};

const demoDatasetItems: DatasetItem[] = [
  {
    id: "item_news_1",
    taskId: "task_news_quality",
    externalKey: "news-1",
    sourcePayload: {
      title: "新能源车销量创下季度新高",
      body: "某行业报告显示，新能源车销量在本季度继续增长，但原文未提供完整统计口径。",
      source: "行业简报",
    },
    status: "AVAILABLE",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
  },
];

export const seedDemoData = {
  tasks: [demoTask],
  schemaDrafts: [demoSchemaDraft],
  datasetItems: demoDatasetItems,
};

console.log(JSON.stringify(seedDemoData, null, 2));
