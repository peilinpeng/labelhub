import type { ID, Task, TaskStatus } from "@labelhub/contracts";

import { auditForTaskCommand } from "./audit-mapping.ts";
import { failTransition, invalidState } from "./errors.ts";
import type { TransitionResult } from "./types.ts";

export function createTask(task: Task): TransitionResult<"createTask", Task, TaskStatus> {
  const command = "createTask";
  if (task.status !== "DRAFT") {
    return invalidState(command, task.status, "createTask 只能创建 DRAFT task");
  }

  return {
    ok: true,
    entity: task,
    command,
    previousStatus: "NONE",
    nextStatus: "DRAFT",
    auditAction: auditForTaskCommand(command),
    sideEffects: [],
  };
}

export interface PublishTaskInput {
  task: Task;
  schemaVersionId?: ID;
  schemaVersionBelongsToTask?: boolean;
  datasetImported?: boolean;
  reviewReady?: boolean;
}

export function publishTask(input: PublishTaskInput): TransitionResult<"publishTask", Task, TaskStatus> {
  const command = "publishTask";
  const { task } = input;
  const activeSchemaVersionId = input.schemaVersionId ?? task.activeSchemaVersionId;

  if (task.status !== "DRAFT") {
    return invalidState(command, task.status, "publishTask 只能从 DRAFT 进入 PUBLISHED");
  }

  if (activeSchemaVersionId === undefined) {
    return failTransition(command, task.status, "VALIDATION_FAILED", "发布 task 前必须提供已发布 schemaVersionId");
  }

  if (input.schemaVersionBelongsToTask === false) {
    return failTransition(command, task.status, "VALIDATION_FAILED", "schemaVersionId 必须属于当前 task");
  }

  if (input.datasetImported === false) {
    return failTransition(command, task.status, "VALIDATION_FAILED", "发布 task 前必须导入 dataset");
  }

  if (input.reviewReady === false) {
    return failTransition(command, task.status, "VALIDATION_FAILED", "发布 task 前必须配置审核策略或显式禁用");
  }

  return {
    ok: true,
    entity: { ...task, status: "PUBLISHED", activeSchemaVersionId },
    command,
    previousStatus: task.status,
    nextStatus: "PUBLISHED",
    auditAction: auditForTaskCommand(command),
    sideEffects: [],
  };
}

export function pauseTask(task: Task): TransitionResult<"pauseTask", Task, TaskStatus> {
  const command = "pauseTask";
  if (task.status !== "PUBLISHED") {
    return invalidState(command, task.status, "pauseTask 只能从 PUBLISHED 进入 PAUSED");
  }

  return {
    ok: true,
    entity: { ...task, status: "PAUSED" },
    command,
    previousStatus: task.status,
    nextStatus: "PAUSED",
    auditAction: auditForTaskCommand(command),
    sideEffects: [],
  };
}

export function resumeTask(task: Task): TransitionResult<"resumeTask", Task, TaskStatus> {
  const command = "resumeTask";
  if (task.status !== "PAUSED") {
    return invalidState(command, task.status, "resumeTask 只能从 PAUSED 回到 PUBLISHED");
  }

  return {
    ok: true,
    entity: { ...task, status: "PUBLISHED" },
    command,
    previousStatus: task.status,
    nextStatus: "PUBLISHED",
    auditAction: auditForTaskCommand(command),
    sideEffects: [],
  };
}

export function endTask(task: Task): TransitionResult<"endTask", Task, TaskStatus> {
  const command = "endTask";
  if (task.status !== "PUBLISHED" && task.status !== "PAUSED") {
    return invalidState(command, task.status, "endTask 只能从 PUBLISHED 或 PAUSED 进入 ENDED");
  }

  return {
    ok: true,
    entity: { ...task, status: "ENDED" },
    command,
    previousStatus: task.status,
    nextStatus: "ENDED",
    auditAction: auditForTaskCommand(command),
    sideEffects: [],
  };
}

export function archiveTask(task: Task): TransitionResult<"archiveTask", Task, TaskStatus> {
  const command = "archiveTask";
  if (task.status !== "ENDED") {
    return invalidState(command, task.status, "archiveTask 只能从 ENDED 进入 ARCHIVED");
  }

  return {
    ok: true,
    entity: { ...task, status: "ARCHIVED" },
    command,
    previousStatus: task.status,
    nextStatus: "ARCHIVED",
    auditAction: auditForTaskCommand(command),
    sideEffects: [],
  };
}
