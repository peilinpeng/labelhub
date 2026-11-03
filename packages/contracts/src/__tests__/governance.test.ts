import { test } from "node:test";
import assert from "node:assert/strict";
import { MIGRATION_JOB_STATUSES, MIGRATION_TRANSITIONS, TASK_PERMISSIONS } from "../governance";

test("迁移契约禁止未审批执行和终态改写", () => {
  assert.deepEqual(Object.keys(MIGRATION_TRANSITIONS).sort(), [...MIGRATION_JOB_STATUSES].sort());
  for (const state of ["DRAFT", "READY", "BLOCKED", "PENDING_APPROVAL"] as const) {
    assert.equal(MIGRATION_TRANSITIONS[state].includes("QUEUED"), false);
  }
  for (const state of ["SUCCEEDED", "PARTIAL", "REJECTED", "CANCELED"] as const) {
    assert.deepEqual(MIGRATION_TRANSITIONS[state], []);
  }
  assert.deepEqual(MIGRATION_TRANSITIONS.APPROVED, ["QUEUED", "CANCELED"]);
  assert.deepEqual(MIGRATION_TRANSITIONS.FAILED, ["QUEUED"]);
});

test("任务权限明确分离计划、审批、执行、读取与授权管理", () => {
  assert.equal(new Set(TASK_PERMISSIONS).size, TASK_PERMISSIONS.length);
  for (const permission of ["migration.plan", "migration.approve", "migration.execute", "migration.read", "permissions.manage"]) {
    assert.ok(TASK_PERMISSIONS.some((entry) => entry === permission));
  }
});
