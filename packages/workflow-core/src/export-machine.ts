import type { ExportJob, ExportJobStatus, ExportMapping, ID, Submission } from "@labelhub/contracts";

import { auditForExportCommand } from "./audit-mapping.ts";
import { failTransition, invalidState } from "./errors.ts";
import { canEnterDefaultExportPool, isExportMappingAllowed } from "./transition-guards.ts";
import type { TransitionResult } from "./types.ts";

export function createExportJob(
  exportJob: ExportJob,
): TransitionResult<"createExportJob", ExportJob, ExportJobStatus> {
  const command = "createExportJob";
  if (exportJob.status !== "PENDING") {
    return invalidState(command, exportJob.status, "createExportJob 创建后必须处于 PENDING");
  }

  if (!isExportMappingAllowed(exportJob.mapping)) {
    return failTransition(command, exportJob.status, "EXPORT_MAPPING_INVALID", "PATCHED_ANSWERS 必须显式允许");
  }

  return {
    ok: true,
    entity: exportJob,
    command,
    previousStatus: "NONE",
    nextStatus: "PENDING",
    auditAction: auditForExportCommand(command),
    sideEffects: [],
  };
}

export function startExportJob(
  exportJob: ExportJob,
): TransitionResult<"startExportJob", ExportJob, ExportJobStatus> {
  const command = "startExportJob";
  if (exportJob.status !== "PENDING") {
    return invalidState(command, exportJob.status, "startExportJob 只能从 PENDING 进入 RUNNING");
  }

  return {
    ok: true,
    entity: { ...exportJob, status: "RUNNING" },
    command,
    previousStatus: exportJob.status,
    nextStatus: "RUNNING",
    auditAction: auditForExportCommand(command),
    sideEffects: [],
  };
}

export function markExportSucceeded(
  exportJob: ExportJob,
  fileId: ID,
): TransitionResult<"markExportSucceeded", ExportJob, ExportJobStatus> {
  const command = "markExportSucceeded";
  if (exportJob.status !== "RUNNING") {
    return invalidState(command, exportJob.status, "markExportSucceeded 只能从 RUNNING 进入 SUCCEEDED");
  }

  return {
    ok: true,
    entity: { ...exportJob, status: "SUCCEEDED", fileId },
    command,
    previousStatus: exportJob.status,
    nextStatus: "SUCCEEDED",
    auditAction: auditForExportCommand(command),
    sideEffects: [{ type: "CREATE_EXPORT_RESULT_FILE", fileId }],
  };
}

export function markExportFailed(
  exportJob: ExportJob,
  errorMessage?: string,
): TransitionResult<"markExportFailed", ExportJob, ExportJobStatus> {
  const command = "markExportFailed";
  if (exportJob.status !== "PENDING" && exportJob.status !== "RUNNING") {
    return invalidState(command, exportJob.status, "markExportFailed 只能从 PENDING 或 RUNNING 进入 FAILED");
  }

  const entity: ExportJob =
    errorMessage === undefined
      ? { ...exportJob, status: "FAILED" }
      : { ...exportJob, status: "FAILED", errorMessage };

  return {
    ok: true,
    entity,
    command,
    previousStatus: exportJob.status,
    nextStatus: "FAILED",
    auditAction: auditForExportCommand(command),
    sideEffects: [],
  };
}

export function cancelExportJob(
  exportJob: ExportJob,
): TransitionResult<"cancelExportJob", ExportJob, ExportJobStatus> {
  const command = "cancelExportJob";
  if (exportJob.status !== "PENDING" && exportJob.status !== "RUNNING") {
    return invalidState(command, exportJob.status, "cancelExportJob 只能取消 PENDING 或 RUNNING export job");
  }

  return {
    ok: true,
    entity: { ...exportJob, status: "CANCELED" },
    command,
    previousStatus: exportJob.status,
    nextStatus: "CANCELED",
    auditAction: auditForExportCommand(command),
    sideEffects: [],
  };
}

export function assertSubmissionCanEnterExportPool(submission: Pick<Submission, "status">): boolean {
  return canEnterDefaultExportPool(submission);
}

export function assertExportMappingAllowed(mapping: ExportMapping): boolean {
  return isExportMappingAllowed(mapping);
}
