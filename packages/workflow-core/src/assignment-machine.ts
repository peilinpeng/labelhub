import type { Assignment, AssignmentStatus } from "@labelhub/contracts";

import { auditForAssignmentCommand } from "./audit-mapping.ts";
import { invalidState } from "./errors.ts";
import type { TransitionResult } from "./types.ts";

export function claimAssignment(
  assignment: Assignment,
): TransitionResult<"claimAssignment", Assignment, AssignmentStatus> {
  const command = "claimAssignment";
  if (assignment.status !== "CLAIMED") {
    return invalidState(command, assignment.status, "claimAssignment 只能创建 CLAIMED assignment");
  }

  return {
    ok: true,
    entity: assignment,
    command,
    previousStatus: "NONE",
    nextStatus: "CLAIMED",
    auditAction: auditForAssignmentCommand(command),
    sideEffects: [],
  };
}

export function saveDraft(assignment: Assignment): TransitionResult<"saveDraft", Assignment, AssignmentStatus> {
  const command = "saveDraft";
  if (!["CLAIMED", "DRAFTING", "RETURNED"].includes(assignment.status)) {
    return invalidState(command, assignment.status, "saveDraft 只允许 CLAIMED、DRAFTING 或 RETURNED");
  }

  return {
    ok: true,
    entity: { ...assignment, status: "DRAFTING" },
    command,
    previousStatus: assignment.status,
    nextStatus: "DRAFTING",
    auditAction: auditForAssignmentCommand(command),
    sideEffects: [{ type: "SAVE_DRAFT", assignmentStatus: "DRAFTING", serverRevisionDelta: 1 }],
  };
}

export function submitAssignment(
  assignment: Assignment,
): TransitionResult<"submitAssignment", Assignment, AssignmentStatus> {
  const command = "submitAssignment";
  if (!["CLAIMED", "DRAFTING", "RETURNED"].includes(assignment.status)) {
    return invalidState(command, assignment.status, "submitAssignment 只允许 CLAIMED、DRAFTING 或 RETURNED");
  }

  return {
    ok: true,
    entity: { ...assignment, status: "SUBMITTED" },
    command,
    previousStatus: assignment.status,
    nextStatus: "SUBMITTED",
    auditAction: auditForAssignmentCommand(command),
    sideEffects: [{ type: "CREATE_SUBMISSION", submissionStatus: "SUBMITTED" }],
  };
}

export function expireAssignment(
  assignment: Assignment,
): TransitionResult<"expireAssignment", Assignment, AssignmentStatus> {
  const command = "expireAssignment";
  if (!["CLAIMED", "DRAFTING"].includes(assignment.status)) {
    return invalidState(command, assignment.status, "expireAssignment 只允许 CLAIMED 或 DRAFTING");
  }

  return {
    ok: true,
    entity: { ...assignment, status: "EXPIRED" },
    command,
    previousStatus: assignment.status,
    nextStatus: "EXPIRED",
    auditAction: auditForAssignmentCommand(command),
    sideEffects: [{ type: "UPDATE_DATASET_ITEM_STATUS", status: "AVAILABLE" }],
  };
}

export function returnAssignment(
  assignment: Assignment,
): TransitionResult<"returnAssignment", Assignment, AssignmentStatus> {
  const command = "returnAssignment";
  if (assignment.status !== "SUBMITTED") {
    return invalidState(command, assignment.status, "returnAssignment 只能从 SUBMITTED 进入 RETURNED");
  }

  return {
    ok: true,
    entity: { ...assignment, status: "RETURNED" },
    command,
    previousStatus: assignment.status,
    nextStatus: "RETURNED",
    auditAction: auditForAssignmentCommand(command),
    sideEffects: [{ type: "UPDATE_DATASET_ITEM_STATUS", status: "LOCKED" }],
  };
}

export function acceptAssignment(
  assignment: Assignment,
): TransitionResult<"acceptAssignment", Assignment, AssignmentStatus> {
  const command = "acceptAssignment";
  if (assignment.status !== "SUBMITTED") {
    return invalidState(command, assignment.status, "acceptAssignment 只能从 SUBMITTED 进入 ACCEPTED");
  }

  return {
    ok: true,
    entity: { ...assignment, status: "ACCEPTED" },
    command,
    previousStatus: assignment.status,
    nextStatus: "ACCEPTED",
    auditAction: auditForAssignmentCommand(command),
    sideEffects: [{ type: "UPDATE_DATASET_ITEM_STATUS", status: "COMPLETED" }],
  };
}

export function cancelAssignment(
  assignment: Assignment,
): TransitionResult<"cancelAssignment", Assignment, AssignmentStatus> {
  const command = "cancelAssignment";
  if (assignment.status === "ACCEPTED" || assignment.status === "CANCELED" || assignment.status === "EXPIRED") {
    return invalidState(command, assignment.status, "cancelAssignment 不能作用于终态 assignment");
  }

  return {
    ok: true,
    entity: { ...assignment, status: "CANCELED" },
    command,
    previousStatus: assignment.status,
    nextStatus: "CANCELED",
    auditAction: auditForAssignmentCommand(command),
    sideEffects: [{ type: "UPDATE_DATASET_ITEM_STATUS", status: "AVAILABLE" }],
  };
}
