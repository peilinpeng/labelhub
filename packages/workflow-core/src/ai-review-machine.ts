import type { AIReviewJob, AIReviewJobStatus } from "@labelhub/contracts";

import { auditForAIReviewCommand } from "./audit-mapping.ts";
import { invalidState } from "./errors.ts";
import type { TransitionResult } from "./types.ts";

export function startAIReviewJob(
  job: AIReviewJob,
): TransitionResult<"startAIReviewJob", AIReviewJob, AIReviewJobStatus> {
  const command = "startAIReviewJob";
  if (job.status !== "PENDING" && job.status !== "RETRYING") {
    return invalidState(command, job.status, "startAIReviewJob 只能从 PENDING 或 RETRYING 进入 RUNNING");
  }

  return {
    ok: true,
    entity: { ...job, status: "RUNNING" },
    command,
    previousStatus: job.status,
    nextStatus: "RUNNING",
    auditAction: auditForAIReviewCommand(command),
    sideEffects: [],
  };
}

export function markAIReviewSucceeded(
  job: AIReviewJob,
): TransitionResult<"markAIReviewSucceeded", AIReviewJob, AIReviewJobStatus> {
  const command = "markAIReviewSucceeded";
  if (job.status !== "RUNNING") {
    return invalidState(command, job.status, "markAIReviewSucceeded 只能从 RUNNING 进入 SUCCEEDED");
  }

  return {
    ok: true,
    entity: { ...job, status: "SUCCEEDED" },
    command,
    previousStatus: job.status,
    nextStatus: "SUCCEEDED",
    auditAction: auditForAIReviewCommand(command),
    sideEffects: [],
  };
}

export function markAIReviewFailed(
  job: AIReviewJob,
): TransitionResult<"markAIReviewFailed", AIReviewJob, AIReviewJobStatus> {
  const command = "markAIReviewFailed";
  if (job.status !== "RUNNING") {
    return invalidState(command, job.status, "markAIReviewFailed 只能从 RUNNING 进入 FAILED");
  }

  return {
    ok: true,
    entity: { ...job, status: "FAILED" },
    command,
    previousStatus: job.status,
    nextStatus: "FAILED",
    auditAction: auditForAIReviewCommand(command),
    sideEffects: [],
  };
}

export function retryAIReviewJob(
  job: AIReviewJob,
): TransitionResult<"retryAIReviewJob", AIReviewJob, AIReviewJobStatus> {
  const command = "retryAIReviewJob";
  if (job.status !== "FAILED") {
    return invalidState(command, job.status, "retryAIReviewJob 只能从 FAILED 进入 RETRYING 或人工兜底");
  }

  if (job.retryCount >= job.maxRetries) {
    return {
      ok: true,
      entity: { ...job, status: "FAILED_TO_HUMAN_REVIEW" },
      command,
      previousStatus: job.status,
      nextStatus: "FAILED_TO_HUMAN_REVIEW",
      auditAction: "AI_REVIEW_FAILED_TO_HUMAN",
      sideEffects: [{ type: "ROUTE_TO_HUMAN_REVIEW", submissionStatus: "NEEDS_HUMAN_REVIEW" }],
    };
  }

  return {
    ok: true,
    entity: { ...job, status: "RETRYING", retryCount: job.retryCount + 1 },
    command,
    previousStatus: job.status,
    nextStatus: "RETRYING",
    auditAction: auditForAIReviewCommand(command),
    sideEffects: [{ type: "SCHEDULE_AI_REVIEW_RETRY", nextStatus: "RETRYING" }],
  };
}

export function markAIReviewFailedToHuman(
  job: AIReviewJob,
): TransitionResult<"markAIReviewFailedToHuman", AIReviewJob, AIReviewJobStatus> {
  const command = "markAIReviewFailedToHuman";
  if (job.status === "SUCCEEDED" || job.status === "FAILED_TO_HUMAN_REVIEW") {
    return invalidState(command, job.status, "markAIReviewFailedToHuman 不能作用于终态 AIReviewJob");
  }

  return {
    ok: true,
    entity: { ...job, status: "FAILED_TO_HUMAN_REVIEW" },
    command,
    previousStatus: job.status,
    nextStatus: "FAILED_TO_HUMAN_REVIEW",
    auditAction: auditForAIReviewCommand(command),
    sideEffects: [{ type: "ROUTE_TO_HUMAN_REVIEW", submissionStatus: "NEEDS_HUMAN_REVIEW" }],
  };
}

export function aiReviewOutputCanModifyAnswers(output: {
  answersPatch?: unknown;
  patchAnswers?: unknown;
  patchedAnswers?: unknown;
}): boolean {
  return output.answersPatch === undefined && output.patchAnswers === undefined && output.patchedAnswers === undefined;
}
