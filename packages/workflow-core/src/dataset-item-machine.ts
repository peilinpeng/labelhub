import type { DatasetItem, DatasetItemStatus, ID } from "@labelhub/contracts";

import { auditForDatasetItemCommand } from "./audit-mapping.ts";
import { invalidState } from "./errors.ts";
import type { TransitionResult } from "./types.ts";

export function importItem(item: DatasetItem): TransitionResult<"importItem", DatasetItem, DatasetItemStatus> {
  const command = "importItem";
  if (item.status !== "AVAILABLE") {
    return invalidState(command, item.status, "importItem 只能创建 AVAILABLE item");
  }

  return {
    ok: true,
    entity: item,
    command,
    previousStatus: "NONE",
    nextStatus: "AVAILABLE",
    auditAction: auditForDatasetItemCommand(command),
    sideEffects: [],
  };
}

export function claimItem(
  item: DatasetItem,
  context?: { assignmentId?: ID; schemaVersionId?: ID },
): TransitionResult<"claimItem", DatasetItem, DatasetItemStatus> {
  const command = "claimItem";
  if (item.status !== "AVAILABLE") {
    return invalidState(command, item.status, "claimItem 只能从 AVAILABLE 进入 LOCKED");
  }

  const entity: DatasetItem =
    context?.assignmentId === undefined
      ? { ...item, status: "LOCKED" }
      : { ...item, status: "LOCKED", currentAssignmentId: context.assignmentId };

  const sideEffects =
    context?.assignmentId !== undefined && context.schemaVersionId !== undefined
      ? [
          {
            type: "CREATE_ASSIGNMENT",
            assignmentStatus: "CLAIMED",
            datasetItemStatus: "LOCKED",
            schemaVersionId: context.schemaVersionId,
          } as const,
        ]
      : [];

  return {
    ok: true,
    entity,
    command,
    previousStatus: item.status,
    nextStatus: "LOCKED",
    auditAction: auditForDatasetItemCommand(command),
    sideEffects,
  };
}

export function releaseItem(item: DatasetItem): TransitionResult<"releaseItem", DatasetItem, DatasetItemStatus> {
  const command = "releaseItem";
  if (item.status !== "LOCKED") {
    return invalidState(command, item.status, "releaseItem 只能从 LOCKED 回到 AVAILABLE");
  }

  return {
    ok: true,
    entity: { ...item, status: "AVAILABLE" },
    command,
    previousStatus: item.status,
    nextStatus: "AVAILABLE",
    auditAction: auditForDatasetItemCommand(command),
    sideEffects: [],
  };
}

export function completeItem(item: DatasetItem): TransitionResult<"completeItem", DatasetItem, DatasetItemStatus> {
  const command = "completeItem";
  if (item.status !== "LOCKED") {
    return invalidState(command, item.status, "completeItem 只能从 LOCKED 进入 COMPLETED");
  }

  return {
    ok: true,
    entity: { ...item, status: "COMPLETED" },
    command,
    previousStatus: item.status,
    nextStatus: "COMPLETED",
    auditAction: auditForDatasetItemCommand(command),
    sideEffects: [],
  };
}

export function disableItem(item: DatasetItem): TransitionResult<"disableItem", DatasetItem, DatasetItemStatus> {
  const command = "disableItem";
  if (item.status === "COMPLETED" || item.status === "DISABLED") {
    return invalidState(command, item.status, "disableItem 不能作用于 COMPLETED 或 DISABLED item");
  }

  return {
    ok: true,
    entity: { ...item, status: "DISABLED" },
    command,
    previousStatus: item.status,
    nextStatus: "DISABLED",
    auditAction: auditForDatasetItemCommand(command),
    sideEffects: [],
  };
}

export function restoreItem(item: DatasetItem): TransitionResult<"restoreItem", DatasetItem, DatasetItemStatus> {
  const command = "restoreItem";
  if (item.status !== "DISABLED") {
    return invalidState(command, item.status, "restoreItem 只能从 DISABLED 回到 AVAILABLE");
  }

  return {
    ok: true,
    entity: { ...item, status: "AVAILABLE" },
    command,
    previousStatus: item.status,
    nextStatus: "AVAILABLE",
    auditAction: auditForDatasetItemCommand(command),
    sideEffects: [],
  };
}
