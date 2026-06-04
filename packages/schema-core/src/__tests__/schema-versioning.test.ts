import { deepEqual, equal, throws } from "node:assert/strict";
import { describe, test } from "node:test";
import type { AnswerPayload, LabelHubRuntimeContext, LabelHubSchema, PublishedLabelHubSchema } from "@labelhub/contracts";
import {
  assertPublishedSchemaImmutable,
  assertSchemaVersionMatched,
  validateSubmissionSchemaBinding,
} from "../index.ts";

const baseContext: LabelHubRuntimeContext = {
  task: {
    id: "task_version_freeze",
    title: "版本冻结测试任务",
    status: "PUBLISHED",
    activeSchemaVersionId: "sv_version_freeze_1",
  },
  schema: {
    schemaId: "schema_version_freeze",
    schemaVersionId: "sv_version_freeze_1",
    schemaVersionNo: 1,
    contractVersion: "1.1",
  },
  item: {
    id: "item_version_freeze_1",
    sourcePayload: {
      title: "示例标题",
    },
  },
  answers: {},
  system: {
    actor: {
      id: "usr_version_tester",
      role: "OWNER",
      displayName: "版本测试员",
    },
    role: "OWNER",
    now: "2026-05-24T00:00:00.000Z",
  },
};

describe("Version Freeze", () => {
  test("DRAFT schema 修改字段 title：允许", () => {
    const previous = createDraftSchema();
    const next = cloneSchema(previous);
    updateFieldTitle(next, "summary", "新的摘要标题");

    assertPublishedSchemaImmutable(previous, next);
  });

  test("PUBLISHED schema 修改字段 title：拒绝", () => {
    const previous = createPublishedSchema();
    const next = cloneSchema(previous);
    updateFieldTitle(next, "summary", "新的摘要标题");

    throws(() => assertPublishedSchemaImmutable(previous, next), /已发布的 SchemaVersion snapshot 不允许被修改/);
  });

  test("PUBLISHED schema 新增 field：拒绝", () => {
    const previous = createPublishedSchema();
    const next = cloneSchema(previous);
    next.root.children.push({
      id: "field_new_comment",
      kind: "FIELD",
      type: "input.text",
      title: "新增备注",
      name: "newComment",
    });

    throws(() => assertPublishedSchemaImmutable(previous, next));
  });

  test("PUBLISHED schema 删除 field：拒绝", () => {
    const previous = createPublishedSchema();
    const next = cloneSchema(previous);
    next.root.children = next.root.children.filter((node) => node.id !== "field_summary");

    throws(() => assertPublishedSchemaImmutable(previous, next));
  });

  test("PUBLISHED schema 修改 option value：拒绝", () => {
    const previous = createPublishedSchema();
    const next = cloneSchema(previous);
    const field = next.root.children.find((node) => node.id === "field_quality");
    if (field?.kind !== "FIELD" || field.type !== "choice.radio") {
      throw new Error("测试 schema 必须包含 quality radio 字段");
    }
    const firstOption = field.options[0];
    if (firstOption === undefined) {
      throw new Error("quality radio 字段必须包含 option");
    }
    field.options[0] = { ...firstOption, value: "approved" };

    throws(() => assertPublishedSchemaImmutable(previous, next));
  });

  test("PUBLISHED schema 修改 schemaVersionId：拒绝", () => {
    const previous = createPublishedSchema();
    const next = {
      ...previous,
      schemaVersionId: "sv_version_freeze_2",
    } satisfies PublishedLabelHubSchema;

    throws(() => assertPublishedSchemaImmutable(previous, next));
  });

  test("PUBLISHED schema 修改 schemaVersionNo：拒绝", () => {
    const previous = createPublishedSchema();
    const next = {
      ...previous,
      schemaVersionNo: 2,
    } satisfies PublishedLabelHubSchema;

    throws(() => assertPublishedSchemaImmutable(previous, next));
  });

  test("PUBLISHED schema 修改 contractVersion：拒绝", () => {
    const previous = createPublishedSchema();
    const next = {
      ...previous,
      contractVersion: "1.0" as unknown as LabelHubSchema["contractVersion"],
    } satisfies PublishedLabelHubSchema;

    throws(() => assertPublishedSchemaImmutable(previous, next));
  });

  test("PUBLISHED schema 完全相同：通过", () => {
    const previous = createPublishedSchema();
    const next = cloneSchema(previous);

    assertPublishedSchemaImmutable(previous, next);
  });
});

describe("SchemaVersion 绑定", () => {
  test("schemaVersionId 一致：通过", () => {
    assertSchemaVersionMatched(
      { schemaVersionId: "sv_version_freeze_1" },
      { schemaVersionId: "sv_version_freeze_1" },
    );
  });

  test("schemaVersionId 不一致：抛错", () => {
    throws(() =>
      assertSchemaVersionMatched(
        { schemaVersionId: "sv_version_freeze_1" },
        { schemaVersionId: "sv_version_freeze_2" },
      ),
    );
  });

  test("schema 缺少 schemaVersionId：抛错", () => {
    throws(() => assertSchemaVersionMatched({}, { schemaVersionId: "sv_version_freeze_1" }));
  });

  test("submission 缺少 schemaVersionId：抛错", () => {
    throws(() => assertSchemaVersionMatched({ schemaVersionId: "sv_version_freeze_1" }, {}));
  });

  test("两者都缺失：抛错", () => {
    throws(() => assertSchemaVersionMatched({}, {}));
  });
});

describe("Submission 与 SchemaVersion 绑定校验", () => {
  test("版本一致时，执行 normalize / validate，并返回 valid result", () => {
    const schema = createPublishedSchema();
    const result = validateSubmissionSchemaBinding(
      schema,
      {
        schemaVersionId: "sv_version_freeze_1",
        answers: {
          summary: "这是一段足够长的摘要",
          qualityRating: "pass",
          unknownField: "会被归一化移除",
        },
      },
      baseContext,
    );

    equal(result.valid, true);
    deepEqual(result.normalizedAnswers, {
      summary: "这是一段足够长的摘要",
      qualityRating: "pass",
    });
  });

  test("版本不一致时，返回 valid: false", () => {
    const result = validateSubmissionSchemaBinding(
      createPublishedSchema(),
      {
        schemaVersionId: "sv_version_freeze_2",
        answers: {
          summary: "这是一段足够长的摘要",
          qualityRating: "pass",
        },
      },
      baseContext,
    );

    equal(result.valid, false);
  });

  test("版本不一致时，不继续执行 normalize / validate", () => {
    const result = validateSubmissionSchemaBinding(
      createPublishedSchema(),
      {
        schemaVersionId: "sv_version_freeze_2",
        answers: {
          summary: "短",
          qualityRating: "unknown",
        },
      },
      baseContext,
    );

    equal(result.errors.length, 1);
    equal(result.errors[0]?.code, "SCHEMA_INVALID");
    equal(result.errors.some((error) => error.fieldName === "summary"), false);
    equal(result.errors.some((error) => error.fieldName === "qualityRating"), false);
  });

  test("返回的 errors 中包含版本不匹配信息", () => {
    const result = validateSubmissionSchemaBinding(
      createPublishedSchema(),
      {
        schemaVersionId: "sv_version_freeze_2",
        answers: {},
      },
      baseContext,
    );

    equal(result.errors[0]?.message.includes("schemaVersionId 不匹配"), true);
  });

  test("不修改原始 submission.answers", () => {
    const answers: AnswerPayload = {
      summary: "这是一段足够长的摘要",
      qualityRating: "pass",
      unknownField: "原始对象保留",
    };
    const before = cloneValue(answers);

    validateSubmissionSchemaBinding(
      createPublishedSchema(),
      {
        schemaVersionId: "sv_version_freeze_1",
        answers,
      },
      baseContext,
    );

    deepEqual(answers, before);
  });
});

function createDraftSchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_version_freeze",
    schemaDraftRevision: 1,
    status: "DRAFT",
    meta: {
      name: "版本冻结测试 schema",
      taskId: "task_version_freeze",
      authorId: "usr_version_tester",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:00.000Z",
    },
    root: {
      id: "root_version_freeze",
      kind: "CONTAINER",
      type: "container.group",
      title: "根节点",
      children: [
        {
          id: "field_summary",
          kind: "FIELD",
          type: "input.textarea",
          title: "摘要",
          name: "summary",
          required: true,
          validations: [{ type: "minLength", value: 5 }],
        },
        {
          id: "field_quality",
          kind: "FIELD",
          type: "choice.radio",
          title: "质量判断",
          name: "qualityRating",
          required: true,
          options: [
            { label: "通过", value: "pass" },
            { label: "拒绝", value: "reject" },
          ],
        },
      ],
    },
  };
}

function createPublishedSchema(): PublishedLabelHubSchema {
  return {
    ...createDraftSchema(),
    schemaVersionId: "sv_version_freeze_1",
    schemaVersionNo: 1,
    status: "PUBLISHED",
    meta: {
      ...createDraftSchema().meta,
      publishedAt: "2026-05-24T00:00:00.000Z",
    },
  };
}

function updateFieldTitle(schema: LabelHubSchema, fieldName: string, title: string): void {
  const field = schema.root.children.find((node) => node.kind === "FIELD" && node.name === fieldName);
  if (field?.kind !== "FIELD") {
    throw new Error(`测试 schema 缺少字段：${fieldName}`);
  }
  field.title = title;
}

function cloneSchema<T extends LabelHubSchema>(schema: T): T {
  return cloneValue(schema);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
