import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { AssignmentContextResponse, ID } from "@labelhub/contracts";
import AssignmentPage from "./AssignmentPage";
import { getAssignmentContext } from "../../mocks/mock-db";
import { authenticateAs, renderRoute } from "../../test/render";
import { server } from "../../test/server";

vi.mock("@labelhub/schema-renderer", () => ({
  SchemaRenderer: ({
    answers,
    readonly,
    onAnswersChange,
  }: {
    answers: Record<string, unknown>;
    readonly: boolean;
    onAnswersChange(answers: Record<string, unknown>): void;
  }) => (
    <label>
      备注
      <input
        aria-label="备注"
        disabled={readonly}
        value={String(answers.note ?? "")}
        onChange={(event) => onAnswersChange({ ...answers, note: event.target.value })}
      />
    </label>
  ),
}));

function renderAssignment(assignmentId: string) {
  authenticateAs("LABELER");
  return renderRoute(<AssignmentPage role="LABELER" />, {
    initialPath: `/labeler/assignments/${assignmentId}`,
    routePath: "/labeler/assignments/:assignmentId",
  });
}

describe("AssignmentPage 标注闭环", () => {
  it("答案变更后自动保存，并在确认后提交进入只读态", async () => {
    const base = structuredClone(getAssignmentContext("asn_1001")!);
    const assignmentId = "asn_opt11";
    const context: AssignmentContextResponse = {
      ...base,
      assignment: { ...base.assignment, id: assignmentId as ID, status: "CLAIMED" },
      schema: {
        ...base.schema,
        root: {
          ...base.schema.root,
          children: [{
            id: "note_field" as ID,
            kind: "FIELD",
            type: "input.text",
            name: "note",
            title: "备注",
            required: false,
          }],
        },
      },
    };
    let saveRequests = 0;
    let submitRequests = 0;
    server.use(
      http.get(`*/api/v1/assignments/${assignmentId}`, () => HttpResponse.json(context)),
      http.get(`*/api/v1/assignments/${assignmentId}/items`, () => HttpResponse.json({ items: [context.item] })),
      http.put(`*/api/v1/assignments/${assignmentId}/draft`, async ({ request }) => {
        saveRequests += 1;
        const body = await request.json() as { answers: Record<string, unknown> };
        return HttpResponse.json({
          draft: {
            assignmentId,
            schemaVersionId: context.schemaVersionId,
            answers: body.answers,
            clientRevision: 0,
            serverRevision: saveRequests,
            savedAt: new Date().toISOString(),
          },
          assignment: { ...context.assignment, status: "DRAFTING" },
          validation: { valid: true, errors: [], warnings: [] },
          auditLog: { id: "audit_save", action: "DRAFT_SAVED", createdAt: new Date().toISOString() },
        });
      }),
      http.post(`*/api/v1/assignments/${assignmentId}/submit`, async ({ request }) => {
        submitRequests += 1;
        const body = await request.json() as { answers: Record<string, unknown> };
        return HttpResponse.json({
          submission: {
            id: "sub_opt11",
            assignmentId,
            taskId: context.task.id,
            itemId: context.item.id,
            labelerId: context.assignment.labelerId,
            schemaVersionId: context.schemaVersionId,
            attemptNo: 1,
            answers: body.answers,
            status: "SUBMITTED",
            validationSnapshot: { valid: true, errors: [], warnings: [] },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          assignment: { ...context.assignment, status: "SUBMITTED" },
          validation: { valid: true, errors: [], warnings: [] },
          nextStatus: "SUBMITTED",
          auditLog: { id: "audit_submit", action: "SUBMISSION_CREATED", createdAt: new Date().toISOString() },
        }, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderAssignment(assignmentId);
    const input = await screen.findByRole("textbox", { name: /备注/ });
    await user.type(input, "自动保存内容");
    await waitFor(() => expect(saveRequests).toBe(1), { timeout: 3_000 });
    expect(screen.getByText(/草稿已自动保存/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "提交当前数据" }));
    const dialog = await screen.findByRole("dialog", { name: "确认提交标注？" });
    await user.click(within(dialog).getByRole("button", { name: "提交标注" }));
    await waitFor(() => expect(submitRequests).toBe(1));
    expect(await screen.findByText(/标注已提交，已进入审核流程/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交当前数据" })).toBeDisabled();
  });

  it("已提交领取记录保持只读并禁止重复保存/提交", async () => {
    renderAssignment("asn_1002");
    expect(await screen.findByText("当前领取记录只读")).toBeInTheDocument();
    expect(screen.getByText(/已经提交，不能重复提交/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提交当前数据" })).toBeDisabled();
  });
});
