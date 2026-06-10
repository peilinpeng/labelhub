import type {
  LabelHubRuntimeContext,
  LabelHubSchema,
  NodeType,
  SchemaNode,
  ServerComponentRegistryItem,
} from "@labelhub/contracts";
import { createEmptySchema, createDefaultNode } from "@labelhub/schema-core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { SchemaDesigner } from "../SchemaDesigner";

const allNodeTypes: NodeType[] = [
  "show.text",
  "input.text",
  "input.textarea",
  "input.richtext",
  "choice.radio",
  "choice.checkbox",
  "choice.select",
  "choice.tags",
  "data.json",
  "upload.file",
  "upload.image",
  "llm.assist",
  "container.section",
  "container.group",
];

const serverRegistry: ServerComponentRegistryItem[] = allNodeTypes.map((type) => ({
  type,
  category: type.startsWith("show.")
    ? "SHOW"
    : type.startsWith("choice.")
      ? "CHOICE"
      : type.startsWith("upload.")
        ? "UPLOAD"
        : type.startsWith("container.")
          ? "LAYOUT"
          : type === "llm.assist"
            ? "AI"
            : type === "data.json"
              ? "DATA"
              : "INPUT",
  valueKind: "STRING",
  normalizer: "noop",
  validators: [],
  exportValueType: "TEXT",
  allowedValidationRules: [],
  defaultSubmitEnabled: !type.startsWith("show.") && !type.startsWith("container.") && type !== "llm.assist",
  defaultExportEnabled: false,
  defaultAiReviewEnabled: false,
}));

const sampleContext: LabelHubRuntimeContext = {
  task: {
    id: "task_designer",
    title: "设计器测试任务",
    status: "DRAFT",
    activeSchemaVersionId: "sv_designer_1",
  },
  schema: {
    schemaId: "schema_task_designer",
    schemaVersionId: "sv_designer_1",
    schemaVersionNo: 1,
    contractVersion: "1.1",
  },
  item: {
    id: "item_designer",
    sourcePayload: {
      text: "预览文本",
    },
  },
  answers: {},
  system: {
    actor: {
      id: "usr_owner",
      role: "OWNER",
      displayName: "Owner",
    },
    role: "OWNER",
    now: "2026-05-25T00:00:00.000Z",
  },
};

describe("SchemaDesigner", () => {
  test("MaterialPanel 点击物料可以新增 textarea 字段", async () => {
    const onSchemaChange = vi.fn();
    renderDesigner({ onSchemaChange });

    fireEvent.click(screen.getByRole("button", { name: "多行文本" }));

    await waitFor(() => expect(screen.getByText("保存字段：textareaField")).toBeTruthy());
    expect(onSchemaChange).toHaveBeenCalled();
  });

  test("DesignerCanvas 可以选择节点", () => {
    const schema = schemaWithNodes([createNode("input.text"), createNode("input.textarea")]);
    const { container } = renderDesigner({ initialSchema: schema });

    const firstNode = getNodeBlock(container, "node_input_text");
    fireEvent.click(within(firstNode).getByRole("button", { name: "选择" }));

    expect(firstNode.dataset.selected).toBe("true");
  });

  test("PropertyPanel 修改 FieldNode.name 会触发 schema 更新", async () => {
    const onSchemaChange = vi.fn();
    const schema = schemaWithNodes([createNode("input.textarea")]);
    renderDesigner({ initialSchema: schema, onSchemaChange });

    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.change(screen.getByLabelText(/字段名称/), { target: { value: "summary" } });

    await waitFor(() =>
      expect(onSchemaChange).toHaveBeenCalledWith(
        expect.objectContaining({
          root: expect.objectContaining({
            children: expect.arrayContaining([expect.objectContaining({ name: "summary" })]),
          }),
        }),
      ),
    );
  });

  test("重复 FieldNode.name 会显示 validation error", async () => {
    const schema = schemaWithNodes([createNode("input.text"), createNode("input.textarea")]);
    renderDesigner({ initialSchema: schema });

    const secondNode = getNodeBlock(document.body, "node_input_textarea");
    fireEvent.click(within(secondNode).getByRole("button", { name: "选择" }));
    fireEvent.change(screen.getByLabelText(/字段名称/), { target: { value: "textField" } });

    await waitFor(() => expect(screen.getAllByText(/必须在 schema version 内唯一/).length).toBeGreaterThan(0));
  });

  test("删除节点后 schema 中不存在该 node", async () => {
    const schema = schemaWithNodes([createNode("input.textarea")]);
    const onSchemaChange = vi.fn();
    renderDesigner({ initialSchema: schema, onSchemaChange });

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() =>
      expect(onSchemaChange).toHaveBeenCalledWith(
        expect.objectContaining({
          root: expect.objectContaining({ children: [] }),
        }),
      ),
    );
  });

  test("上移和下移节点可以改变顺序", async () => {
    const schema = schemaWithNodes([createNode("input.text"), createNode("input.textarea")]);
    const onSchemaChange = vi.fn();
    renderDesigner({ initialSchema: schema, onSchemaChange });

    const firstNode = getNodeBlock(document.body, "node_input_text");
    fireEvent.click(within(firstNode).getByRole("button", { name: "下移" }));

    await waitFor(() => {
      const latest = lastSchemaChange(onSchemaChange);
      expect(latest.root.children[0]?.id).toBe("node_input_textarea");
      expect(latest.root.children[1]?.id).toBe("node_input_text");
    });
  });

  test("SchemaPreview 使用 PREVIEW mode 渲染", () => {
    const schema = schemaWithNodes([createNode("show.text")]);
    const { container } = renderDesigner({ initialSchema: schema });

    expect(container.querySelector('[data-renderer-mode="PREVIEW"]')).toBeTruthy();
    expect(screen.getByText("预览文本")).toBeTruthy();
  });

  test("readonly 模式下不能新增或删除节点", () => {
    const schema = schemaWithNodes([createNode("input.textarea")]);
    const onSchemaChange = vi.fn();
    renderDesigner({ initialSchema: schema, readonly: true, onSchemaChange });

    expect((screen.getByRole("button", { name: "多行文本" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "删除" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("LLMAssist outputBinding 指向不存在 field 时 ValidationPanel 显示错误", () => {
    const llmNode = {
      ...createNode("llm.assist"),
      outputBindings: [
        {
          from: "$.output.summary",
          toFieldName: "missingField",
          mode: "REPLACE",
          requireUserConfirm: true,
        },
      ],
    } as SchemaNode;
    const schema = schemaWithNodes([llmNode]);

    renderDesigner({ initialSchema: schema });

    expect(screen.getAllByText(/toFieldName 必须指向存在的/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/toFieldName/).length).toBeGreaterThan(0);
  });

  test("ShowItem sourcePath 非法时 ValidationPanel 显示错误", () => {
    const showNode = {
      ...createNode("show.text"),
      sourcePath: "$.sourcePayload.text",
    } as SchemaNode;
    const schema = schemaWithNodes([showNode]);

    renderDesigner({ initialSchema: schema });

    expect(screen.getAllByText(/sourcePath 必须使用 RuntimeContext/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sourcePath/).length).toBeGreaterThan(0);
  });
});

interface RenderDesignerOptions {
  initialSchema?: LabelHubSchema;
  readonly?: boolean;
  onSchemaChange?: (schema: LabelHubSchema) => void;
}

function renderDesigner(options: RenderDesignerOptions = {}) {
  const initialSchema = options.initialSchema ?? createEmptySchema("task_designer", "usr_owner");

  function Harness() {
    const [schema, setSchema] = useState(initialSchema);
    const readonlyProps = options.readonly === undefined ? {} : { readonly: options.readonly };
    return (
      <SchemaDesigner
        sampleContext={sampleContext}
        schema={schema}
        serverRegistry={serverRegistry}
        {...readonlyProps}
        onSchemaChange={(nextSchema) => {
          setSchema(nextSchema);
          options.onSchemaChange?.(nextSchema);
        }}
      />
    );
  }

  return render(<Harness />);
}

function schemaWithNodes(nodes: SchemaNode[]): LabelHubSchema {
  const schema = createEmptySchema("task_designer", "usr_owner");
  return {
    ...schema,
    root: {
      ...schema.root,
      children: nodes,
    },
  };
}

function createNode(type: NodeType): SchemaNode {
  return createDefaultNode(type);
}

function getNodeBlock(container: ParentNode, nodeId: string): HTMLElement {
  const element = container.querySelector(`[data-node-id="${nodeId}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`找不到节点：${nodeId}`);
  }
  return element;
}

function lastSchemaChange(onSchemaChange: ReturnType<typeof vi.fn>): LabelHubSchema {
  const calls = onSchemaChange.mock.calls;
  const latest = calls[calls.length - 1]?.[0];
  if (!isLabelHubSchema(latest)) {
    throw new Error("未捕获 schema 更新");
  }
  return latest;
}

function isLabelHubSchema(value: unknown): value is LabelHubSchema {
  return typeof value === "object" && value !== null && "root" in value;
}
