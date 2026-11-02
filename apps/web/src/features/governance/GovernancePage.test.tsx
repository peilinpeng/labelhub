import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import GovernancePage from "./GovernancePage";
import * as api from "../../api/governance";
import { mockDb } from "../../mocks/mock-db/state";
import type { SchemaVersion } from "@labelhub/contracts";

it("新工作台选择版本和历史范围，预演后必须交由另一用户审批", async () => {
  localStorage.setItem("labelhub_token", "mock_token_owner");
  const source = mockDb.schemaVersions.find((version) => version.id === "sv_news_quality_1")!;
  const target: SchemaVersion = structuredClone(source);
  target.id = "sv_governance_test"; target.schemaVersionNo = 999; target.snapshot.schemaVersionId = target.id; target.snapshot.schemaVersionNo = 999;
  mockDb.schemaVersions.push(target);
  try {
    render(<MemoryRouter initialEntries={["/owner/governance?taskId=task_news_quality"]}><GovernancePage /></MemoryRouter>);
    await screen.findByRole("heading", { name: "新建迁移计划" });
    await waitFor(() => expect(screen.getByLabelText("目标版本")).toHaveTextContent("999"));
    fireEvent.change(screen.getByLabelText("源版本"), { target: { value: source.id } });
    fireEvent.change(screen.getByLabelText("目标版本"), { target: { value: target.id } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /sub_1001/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建计划" }));
    const dryRun = await screen.findByRole("button", { name: "执行预演" });
    await waitFor(() => expect(dryRun).toBeEnabled());
    fireEvent.click(dryRun);
    const submit = await screen.findByRole("button", { name: "提交独立审批" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await screen.findByRole("button", { name: "批准此摘要" });
    const job = (await api.listMigrations("task_news_quality")).items[0]!;
    await expect(api.migrationCommand(job.taskId, job.id, "execute")).rejects.toThrow("当前状态不允许");
    await expect(api.migrationCommand(job.taskId, job.id, "approve", { checksum: job.checksum!, reason: "自批" })).rejects.toThrow("审批人必须");
    await api.createGrants(job.taskId, { userId: "usr_reviewer", actions: ["migration.read", "migration.approve"], effect: "ALLOW" });
    localStorage.setItem("labelhub_token", "mock_token_reviewer");
    await api.migrationCommand(job.taskId, job.id, "approve", { checksum: job.checksum!, reason: "已核对" });
    localStorage.setItem("labelhub_token", "mock_token_owner");
    const completed = await api.migrationCommand(job.taskId, job.id, "execute");
    expect(completed.status).toBe("SUCCEEDED");
    expect((await api.migrationRecords(job.taskId, job.id)).items).toHaveLength(1);
  } finally { mockDb.schemaVersions.splice(mockDb.schemaVersions.indexOf(target), 1); }
});
