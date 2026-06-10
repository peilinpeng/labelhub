import type {
  FieldNode,
  ID,
  LabelHubSchema,
  PublishedLabelHubSchema,
  SchemaNode,
  SchemaVersion,
  Task,
} from "@labelhub/contracts";

const ownerId = "usr_owner" as ID;
const createdAt = "2026-06-01T09:00:00.000Z";
const updatedAt = "2026-06-02T09:00:00.000Z";

export const schemaGovernanceDemoTasks: Task[] = [
  createDemoTask({
    id: "task_demo_schema_safe_publish" as ID,
    title: "Demo A：安全发布",
    description: "非破坏性模板调整，发布前检查通过并写入审计日志。",
    activeSchemaVersionId: "sv_demo_schema_safe_publish_1" as ID,
  }),
  createDemoTask({
    id: "task_demo_schema_breaking_change" as ID,
    title: "Demo B：Breaking Change 阻断",
    description: "删除历史字段，发布前检查会阻断发布。",
    activeSchemaVersionId: "sv_demo_schema_breaking_change_1" as ID,
  }),
  createDemoTask({
    id: "task_demo_schema_deprecation" as ID,
    title: "Demo C：Deprecated 字段",
    description: "字段进入废弃流程，需要管理员确认后发布。",
    activeSchemaVersionId: "sv_demo_schema_deprecation_1" as ID,
  }),
  createDemoTask({
    id: "task_demo_schema_migration_required" as ID,
    title: "Demo D：Migration Required",
    description: "字段类型需要迁移，发布前预览展示 migration required。",
    activeSchemaVersionId: "sv_demo_schema_migration_required_1" as ID,
  }),
];

export const schemaGovernanceDemoSchemaVersions: SchemaVersion[] = [
  createSchemaVersion({
    id: "sv_demo_schema_safe_publish_1" as ID,
    taskId: "task_demo_schema_safe_publish" as ID,
    schemaId: "schema_demo_schema_safe_publish" as ID,
    name: "安全发布旧版本",
    description: "Demo A 的已发布旧版本。",
    fields: baseQualityFields(),
    snapshotHash: "sha256:demo-safe-v1",
  }),
  createSchemaVersion({
    id: "sv_demo_schema_breaking_change_1" as ID,
    taskId: "task_demo_schema_breaking_change" as ID,
    schemaId: "schema_demo_schema_breaking_change" as ID,
    name: "Breaking Change 旧版本",
    description: "Demo B 的已发布旧版本，包含 summary 字段。",
    fields: baseQualityFields(),
    snapshotHash: "sha256:demo-breaking-v1",
  }),
  createSchemaVersion({
    id: "sv_demo_schema_deprecation_1" as ID,
    taskId: "task_demo_schema_deprecation" as ID,
    schemaId: "schema_demo_schema_deprecation" as ID,
    name: "Deprecated 旧版本",
    description: "Demo C 的已发布旧版本，包含 legacyComment 字段。",
    fields: deprecationOldFields(),
    snapshotHash: "sha256:demo-deprecation-v1",
  }),
  createSchemaVersion({
    id: "sv_demo_schema_migration_required_1" as ID,
    taskId: "task_demo_schema_migration_required" as ID,
    schemaId: "schema_demo_schema_migration_required" as ID,
    name: "Migration Required 旧版本",
    description: "Demo D 的已发布旧版本，riskLevel 为单选。",
    fields: migrationOldFields(),
    snapshotHash: "sha256:demo-migration-v1",
  }),
];

export const schemaGovernanceDemoSchemaDrafts: LabelHubSchema[] = [
  createDraftSchema({
    taskId: "task_demo_schema_safe_publish" as ID,
    schemaId: "schema_demo_schema_safe_publish" as ID,
    name: "安全发布新草稿",
    description: "新增可选字段，不产生 breaking change。",
    fields: [
      ...baseQualityFields(),
      textField({
        id: "demo_safe_review_note",
        name: "reviewNote",
        title: "补充备注",
        description: "可选字段，用于演示 SAFE 新增字段。",
        required: false,
      }),
    ],
  }),
  createDraftSchema({
    taskId: "task_demo_schema_breaking_change" as ID,
    schemaId: "schema_demo_schema_breaking_change" as ID,
    name: "Breaking Change 新草稿",
    description: "删除 summary 字段，触发发布阻断。",
    fields: [
      radioField({
        id: "demo_breaking_category",
        name: "category",
        title: "内容类别",
        required: true,
        options: categoryOptions(),
      }),
      radioField({
        id: "demo_breaking_quality",
        name: "qualityRating",
        title: "质量评级",
        required: true,
        options: qualityOptions(),
      }),
    ],
  }),
  createDraftSchema({
    taskId: "task_demo_schema_deprecation" as ID,
    schemaId: "schema_demo_schema_deprecation" as ID,
    name: "Deprecated 新草稿",
    description: "保留 legacyComment，并配置 replacementFieldName。",
    fields: [
      textField({
        id: "demo_deprecation_legacy_comment",
        name: "legacyComment",
        title: "旧版备注",
        required: false,
        deprecation: {
          deprecated: true,
          reason: "旧版备注字段将由结构更清晰的 reviewComment 替代。",
          replacementFieldName: "reviewComment",
          hideForNewSubmissions: true,
          plannedRemovalSchemaVersionNo: 3,
        },
      }),
      textField({
        id: "demo_deprecation_review_comment",
        name: "reviewComment",
        title: "审核备注",
        description: "legacyComment 的替代字段。",
        required: false,
      }),
      radioField({
        id: "demo_deprecation_quality",
        name: "qualityRating",
        title: "质量评级",
        required: true,
        options: qualityOptions(),
      }),
    ],
  }),
  createDraftSchema({
    taskId: "task_demo_schema_migration_required" as ID,
    schemaId: "schema_demo_schema_migration_required" as ID,
    name: "Migration Required 新草稿",
    description: "riskLevel 从单选升级为多选，触发 migration required。",
    fields: [
      checkboxField({
        id: "demo_migration_risk",
        name: "riskLevel",
        title: "风险等级",
        required: true,
        options: riskOptions(),
      }),
      textField({
        id: "demo_migration_summary",
        name: "summary",
        title: "摘要说明",
        required: false,
      }),
    ],
  }),
];

function createDemoTask(input: {
  id: ID;
  title: string;
  description: string;
  activeSchemaVersionId: ID;
}): Task {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    tags: ["Schema Governance", "Demo"],
    quota: {
      total: 20,
      perLabeler: 5,
    },
    distributionStrategy: {
      type: "FIRST_COME_FIRST_SERVED",
    },
    reviewPolicy: {
      type: "SINGLE_REVIEW",
    },
    status: "DRAFT",
    activeSchemaVersionId: input.activeSchemaVersionId,
    ownerId,
    createdAt,
    updatedAt,
  };
}

function createSchemaVersion(input: {
  id: ID;
  taskId: ID;
  schemaId: ID;
  name: string;
  description: string;
  fields: FieldNode[];
  snapshotHash: string;
}): SchemaVersion {
  const snapshot = createPublishedSchema({
    taskId: input.taskId,
    schemaId: input.schemaId,
    schemaVersionId: input.id,
    name: input.name,
    description: input.description,
    fields: input.fields,
  });

  return {
    id: input.id,
    schemaId: input.schemaId,
    taskId: input.taskId,
    schemaVersionNo: 1,
    snapshotHash: input.snapshotHash,
    contractVersion: "1.1",
    snapshot,
    createdAt,
  };
}

function createPublishedSchema(input: {
  taskId: ID;
  schemaId: ID;
  schemaVersionId: ID;
  name: string;
  description: string;
  fields: FieldNode[];
}): PublishedLabelHubSchema {
  return {
    ...createBaseSchema({
      taskId: input.taskId,
      schemaId: input.schemaId,
      name: input.name,
      description: input.description,
      fields: input.fields,
    }),
    schemaVersionId: input.schemaVersionId,
    schemaVersionNo: 1,
    status: "PUBLISHED",
    meta: {
      ...createBaseMeta(input.taskId, input.name, input.description),
      publishedAt: createdAt,
    },
  };
}

function createDraftSchema(input: {
  taskId: ID;
  schemaId: ID;
  name: string;
  description: string;
  fields: FieldNode[];
}): LabelHubSchema {
  return createBaseSchema(input);
}

function createBaseSchema(input: {
  taskId: ID;
  schemaId: ID;
  name: string;
  description: string;
  fields: FieldNode[];
}): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: input.schemaId,
    schemaDraftRevision: 1,
    status: "DRAFT",
    meta: createBaseMeta(input.taskId, input.name, input.description),
    root: {
      id: `${input.schemaId}_root`,
      kind: "CONTAINER",
      type: "container.section",
      title: input.name,
      children: [
        showTextNode(input.schemaId),
        ...input.fields,
      ],
    },
  };
}

function createBaseMeta(taskId: ID, name: string, description: string): LabelHubSchema["meta"] {
  return {
    name,
    description,
    taskId,
    authorId: ownerId,
    createdAt,
    updatedAt,
  };
}

function showTextNode(schemaId: ID): SchemaNode {
  return {
    id: `${schemaId}_source_text`,
    kind: "SHOW_ITEM",
    type: "show.text",
    title: "样本文本",
    sourcePath: "$.item.sourcePayload.body",
    transform: {
      type: "TEXT",
      fallback: "暂无样本文本",
    },
  };
}

function baseQualityFields(): FieldNode[] {
  return [
    textField({
      id: "demo_summary",
      name: "summary",
      title: "摘要",
      required: true,
    }),
    radioField({
      id: "demo_category",
      name: "category",
      title: "内容类别",
      required: true,
      options: categoryOptions(),
    }),
    radioField({
      id: "demo_quality",
      name: "qualityRating",
      title: "质量评级",
      required: true,
      options: qualityOptions(),
    }),
  ];
}

function deprecationOldFields(): FieldNode[] {
  return [
    textField({
      id: "demo_deprecation_legacy_comment",
      name: "legacyComment",
      title: "旧版备注",
      required: false,
    }),
    radioField({
      id: "demo_deprecation_quality",
      name: "qualityRating",
      title: "质量评级",
      required: true,
      options: qualityOptions(),
    }),
  ];
}

function migrationOldFields(): FieldNode[] {
  return [
    radioField({
      id: "demo_migration_risk",
      name: "riskLevel",
      title: "风险等级",
      required: true,
      options: riskOptions(),
    }),
    textField({
      id: "demo_migration_summary",
      name: "summary",
      title: "摘要说明",
      required: false,
    }),
  ];
}

function textField(input: {
  id: string;
  name: string;
  title: string;
  description?: string;
  required?: boolean;
  deprecation?: FieldNode["deprecation"];
}): FieldNode {
  return {
    id: input.id,
    kind: "FIELD",
    type: "input.textarea",
    name: input.name,
    title: input.title,
    description: input.description,
    required: input.required,
    placeholder: "请输入内容",
    minRows: 3,
    validations: input.required === true ? [{ type: "required", message: `请填写${input.title}` }] : [],
    deprecation: input.deprecation,
  };
}

function radioField(input: {
  id: string;
  name: string;
  title: string;
  required?: boolean;
  options: Array<{ label: string; value: string }>;
}): FieldNode {
  return {
    id: input.id,
    kind: "FIELD",
    type: "choice.radio",
    name: input.name,
    title: input.title,
    required: input.required,
    options: input.options,
    validations: input.required === true ? [{ type: "required", message: `请选择${input.title}` }] : [],
  };
}

function checkboxField(input: {
  id: string;
  name: string;
  title: string;
  required?: boolean;
  options: Array<{ label: string; value: string }>;
}): FieldNode {
  return {
    id: input.id,
    kind: "FIELD",
    type: "choice.checkbox",
    name: input.name,
    title: input.title,
    required: input.required,
    options: input.options,
    validations: input.required === true ? [{ type: "minItems", value: 1, message: `请选择${input.title}` }] : [],
  };
}

function categoryOptions(): Array<{ label: string; value: string }> {
  return [
    { label: "产品", value: "product" },
    { label: "内容", value: "content" },
    { label: "风控", value: "risk" },
  ];
}

function qualityOptions(): Array<{ label: string; value: string }> {
  return [
    { label: "高", value: "high" },
    { label: "中", value: "medium" },
    { label: "低", value: "low" },
  ];
}

function riskOptions(): Array<{ label: string; value: string }> {
  return [
    { label: "低风险", value: "low" },
    { label: "中风险", value: "medium" },
    { label: "高风险", value: "high" },
  ];
}
