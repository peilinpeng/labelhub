import type { ID, LabelHubSchema, NodeType, SchemaNode } from "@labelhub/contracts";
import { SchemaCoreError } from "./json-path.ts";

const serverSupportedNodeTypes = new Set<string>([
  "input.text",
  "input.textarea",
  "input.richtext",
  "choice.radio",
  "choice.checkbox",
  "choice.select",
  "choice.tags",
  "upload.file",
  "upload.image",
  "data.json",
  "show.text",
  "show.richtext",
  "show.image",
  "show.file",
  "show.json",
  "container.group",
  "container.tabs",
  "container.section",
  "llm.assist",
] satisfies NodeType[]);

export function createEmptySchema(taskId: ID, authorId: ID): LabelHubSchema {
  const now = new Date().toISOString();

  return {
    contractVersion: "1.1",
    schemaId: createSchemaId(taskId),
    schemaDraftRevision: 1,
    status: "DRAFT",
    meta: {
      name: "未命名标注模板",
      taskId,
      authorId,
      createdAt: now,
      updatedAt: now,
    },
    root: {
      id: "root",
      kind: "CONTAINER",
      type: "container.section",
      title: "标注模板",
      children: [],
    },
  };
}

export function createDefaultNode(type: NodeType): SchemaNode {
  if (!serverSupportedNodeTypes.has(type)) {
    throw new SchemaCoreError("UNKNOWN_NODE_TYPE", `不支持的 node.type：${type}`);
  }

  switch (type) {
    case "input.text":
      return {
        id: "node_input_text",
        kind: "FIELD",
        type,
        name: "textField",
        title: "单行文本",
      };
    case "input.textarea":
      return {
        id: "node_input_textarea",
        kind: "FIELD",
        type,
        name: "textareaField",
        title: "多行文本",
        minRows: 3,
      };
    case "input.richtext":
      return {
        id: "node_input_richtext",
        kind: "FIELD",
        type,
        name: "richTextField",
        title: "富文本",
        toolbarPreset: "BASIC",
      };
    case "choice.radio":
      return {
        id: "node_choice_radio",
        kind: "FIELD",
        type,
        name: "radioField",
        title: "单选",
        options: [
          { label: "选项 A", value: "a" },
          { label: "选项 B", value: "b" },
        ],
      };
    case "choice.checkbox":
      return {
        id: "node_choice_checkbox",
        kind: "FIELD",
        type,
        name: "checkboxField",
        title: "多选",
        multiple: true,
        options: [
          { label: "选项 A", value: "a" },
          { label: "选项 B", value: "b" },
        ],
      };
    case "choice.select":
      return {
        id: "node_choice_select",
        kind: "FIELD",
        type,
        name: "selectField",
        title: "下拉选择",
        options: [
          { label: "选项 A", value: "a" },
          { label: "选项 B", value: "b" },
        ],
      };
    case "choice.tags":
      return {
        id: "node_choice_tags",
        kind: "FIELD",
        type,
        name: "tagsField",
        title: "标签",
        multiple: true,
        options: [
          { label: "标签 A", value: "tag_a" },
          { label: "标签 B", value: "tag_b" },
        ],
      };
    case "upload.file":
      return {
        id: "node_upload_file",
        kind: "FIELD",
        type,
        name: "fileField",
        title: "文件上传",
        maxCount: 1,
      };
    case "upload.image":
      return {
        id: "node_upload_image",
        kind: "FIELD",
        type,
        name: "imageField",
        title: "图片上传",
        accept: ["image/png", "image/jpeg"],
        maxCount: 1,
      };
    case "data.json":
      return {
        id: "node_data_json",
        kind: "FIELD",
        type,
        name: "jsonField",
        title: "JSON 数据",
        editorMode: "TREE",
      };
    case "show.text":
      return {
        id: "node_show_text",
        kind: "SHOW_ITEM",
        type,
        title: "展示文本",
        sourcePath: "$.item.sourcePayload.text",
        transform: { type: "TEXT", fallback: "" },
      };
    case "show.richtext":
      return {
        id: "node_show_richtext",
        kind: "SHOW_ITEM",
        type,
        title: "展示富文本",
        sourcePath: "$.item.sourcePayload.richText",
        transform: { type: "MARKDOWN" },
      };
    case "show.image":
      return {
        id: "node_show_image",
        kind: "SHOW_ITEM",
        type,
        title: "展示图片",
        sourcePath: "$.item.sourcePayload.image",
        transform: { type: "IMAGE_PREVIEW" },
      };
    case "show.file":
      return {
        id: "node_show_file",
        kind: "SHOW_ITEM",
        type,
        title: "展示文件",
        sourcePath: "$.item.sourcePayload.file",
        transform: { type: "FILE_URLS" },
      };
    case "show.json":
      return {
        id: "node_show_json",
        kind: "SHOW_ITEM",
        type,
        title: "展示 JSON",
        sourcePath: "$.item.sourcePayload.payload",
        transform: { type: "JSON_STRINGIFY", space: 2 },
      };
    case "container.group":
      return {
        id: "node_container_group",
        kind: "CONTAINER",
        type,
        title: "分组",
        children: [],
        layout: { columns: 1 },
      };
    case "container.tabs":
      return {
        id: "node_container_tabs",
        kind: "CONTAINER",
        type,
        title: "标签页",
        children: [],
        layout: { tabStyle: "LINE" },
      };
    case "container.section":
      return {
        id: "node_container_section",
        kind: "CONTAINER",
        type,
        title: "章节",
        children: [],
      };
    case "llm.assist":
      return {
        id: "node_llm_assist",
        kind: "LLM_ASSIST",
        type,
        title: "AI 辅助",
        trigger: "MANUAL",
        inputBindings: {},
        outputMode: "SUGGESTION",
      };
  }
}

export function createNewsQualitySchema(): LabelHubSchema {
  return {
    contractVersion: "1.1",
    schemaId: "schema_news_quality_core",
    schemaDraftRevision: 1,
    status: "DRAFT",
    meta: {
      name: "新闻质量标注模板",
      description: "用于演示新闻正文展示、质量判断、摘要建议和 AI 辅助",
      taskId: "task_news_quality_core",
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
          id: "show_news_title",
          kind: "SHOW_ITEM",
          type: "show.text",
          title: "新闻标题",
          sourcePath: "$.item.sourcePayload.title",
          transform: { type: "TEXT", fallback: "无标题" },
        },
        {
          id: "show_news_body",
          kind: "SHOW_ITEM",
          type: "show.text",
          title: "新闻正文",
          sourcePath: "$.item.sourcePayload.body",
          transform: { type: "TEXT", fallback: "无正文" },
        },
        {
          id: "quality_rating",
          kind: "FIELD",
          type: "choice.radio",
          name: "qualityRating",
          title: "质量判断",
          required: true,
          options: [
            { label: "通过", value: "pass" },
            { label: "需要修改", value: "needs_revision" },
            { label: "不可用", value: "rejected" },
          ],
          validations: [{ type: "required", message: "请选择质量判断" }],
        },
        {
          id: "summary",
          kind: "FIELD",
          type: "input.textarea",
          name: "summary",
          title: "新闻摘要",
          required: true,
          minRows: 3,
          validations: [
            { type: "required", message: "请填写新闻摘要" },
            { type: "minLength", value: 10, message: "新闻摘要至少 10 个字符" },
          ],
        },
        {
          id: "rewrite_suggestion",
          kind: "FIELD",
          type: "input.textarea",
          name: "rewriteSuggestion",
          title: "修改建议",
          minRows: 3,
          preserveWhenHidden: true,
          visibleWhen: {
            op: "eq",
            left: { kind: "path", path: "$.answers.qualityRating" },
            right: { kind: "literal", value: "needs_revision" },
          },
        },
        {
          id: "ai_summary_helper",
          kind: "LLM_ASSIST",
          type: "llm.assist",
          title: "AI 摘要建议",
          trigger: "MANUAL",
          promptTemplate: "请根据新闻标题和正文生成简洁摘要，并指出可能的质量问题。",
          inputBindings: {
            title: "$.item.sourcePayload.title",
            body: "$.item.sourcePayload.body",
            qualityRating: "$.answers.qualityRating",
          },
          outputMode: "SUGGESTION",
          outputBindings: [
            {
              from: "$.output.summary",
              toFieldName: "summary",
              mode: "REPLACE",
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
}

function createSchemaId(taskId: ID): ID {
  return `schema_${toSafeIdPart(taskId)}` as ID;
}

function toSafeIdPart(value: string): string {
  return value.replace(/^[a-z]+_/, "").replace(/[^A-Za-z0-9_]/g, "_");
}
