import type { ErrorCode, WorkflowCommand } from "@labelhub/contracts";
import type { TransitionFailure, WorkflowStatus } from "./types.ts";

export function failTransition<TCommand extends WorkflowCommand, TStatus extends WorkflowStatus>(
  command: TCommand,
  previousStatus: TStatus | "NONE",
  errorCode: ErrorCode,
  message: string,
): TransitionFailure<TCommand, TStatus> {
  return {
    ok: false,
    command,
    previousStatus,
    errorCode,
    message,
    sideEffects: [],
  };
}

export function invalidState<TCommand extends WorkflowCommand, TStatus extends WorkflowStatus>(
  command: TCommand,
  previousStatus: TStatus | "NONE",
  message = "非法状态迁移",
): TransitionFailure<TCommand, TStatus> {
  return failTransition(command, previousStatus, "INVALID_STATE_TRANSITION", message);
}

export function reasonRequired<TCommand extends WorkflowCommand, TStatus extends WorkflowStatus>(
  command: TCommand,
  previousStatus: TStatus | "NONE",
): TransitionFailure<TCommand, TStatus> {
  return failTransition(command, previousStatus, "REVIEW_REASON_REQUIRED", "RETURN 或 REJECT 必须填写 reason");
}
