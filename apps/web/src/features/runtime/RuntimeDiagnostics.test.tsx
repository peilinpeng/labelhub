import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LabelHubRuntimeContext, LabelHubSchema } from "@labelhub/contracts";
import { RuntimeDiagnostics } from "./RuntimeDiagnostics";
const schema: LabelHubSchema = { contractVersion: "1.1", schemaId: "schema_trace", status: "DRAFT", meta: { taskId: "task_trace", name: "追踪", authorId: "usr_owner", createdAt: "2026-11-02", updatedAt: "2026-11-02" }, root: { kind: "CONTAINER", type: "container.section", id: "root", title: "表单", children: [
  { kind: "FIELD", id: "source", type: "input.text", name: "source", title: "输入字段" },
  { kind: "FIELD", id: "target", type: "input.text", name: "target", title: "联动字段", visibleWhen: { op: "notEmpty", value: { kind: "path", path: "$.answers.source" } } },
] } };
const context: LabelHubRuntimeContext = { task: { id: "task_trace", title: "追踪", status: "DRAFT", activeSchemaVersionId: "sv_trace" }, schema: { schemaId: "schema_trace", schemaVersionId: "sv_trace", schemaVersionNo: 1, contractVersion: "1.1" }, item: { id: "item_trace", sourcePayload: {} }, answers: {}, system: { actor: { id: "usr_owner", role: "OWNER", displayName: "负责人" }, role: "OWNER", now: "2026-11-02T00:00:00Z" } };
describe("运行诊断", () => {
  it("显示权威依赖边与真实规则事件，追踪不含答案，关闭清空", async () => {
    render(<RuntimeDiagnostics schema={schema} context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "打开运行诊断" }));
    expect(await screen.findByRole("img", { name: "字段依赖图" })).toHaveTextContent("source");
    const input = screen.getAllByRole("textbox")[0]!;
    fireEvent.change(input, { target: { value: "私密答案-不得记录" } });
    await waitFor(() => expect(screen.getByRole("log")).toHaveTextContent("RULE_EVALUATED"));
    expect(screen.getByRole("log")).not.toHaveTextContent("私密答案-不得记录");
    fireEvent.click(screen.getByRole("button", { name: "清空追踪" }));
    expect(screen.getByRole("log")).not.toHaveTextContent("RULE_EVALUATED");
    fireEvent.click(screen.getByRole("button", { name: "关闭运行诊断" }));
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
  });
});
