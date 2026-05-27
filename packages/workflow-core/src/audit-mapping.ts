import type {
  AIReviewWorkflowCommand,
  AssignmentWorkflowCommand,
  AuditAction,
  DatasetItemWorkflowCommand,
  ExportWorkflowCommand,
  FileWorkflowCommand,
  ReviewPolicy,
  ReviewWorkflowCommand,
  SubmissionWorkflowCommand,
  TaskWorkflowCommand,
} from "@labelhub/contracts";

export function auditForTaskCommand(command: TaskWorkflowCommand): AuditAction {
  const mapping: Record<TaskWorkflowCommand, AuditAction> = {
    createTask: "TASK_CREATED",
    publishTask: "TASK_PUBLISHED",
    pauseTask: "TASK_PAUSED",
    resumeTask: "TASK_RESUMED",
    endTask: "TASK_ENDED",
    archiveTask: "TASK_ARCHIVED",
  };
  return mapping[command];
}

export function auditForDatasetItemCommand(command: DatasetItemWorkflowCommand): AuditAction {
  const mapping: Record<DatasetItemWorkflowCommand, AuditAction> = {
    importItem: "DATASET_IMPORTED",
    claimItem: "ASSIGNMENT_CLAIMED",
    releaseItem: "ASSIGNMENT_EXPIRED",
    completeItem: "REVIEW_ACCEPTED",
    disableItem: "REVIEW_REJECTED",
    restoreItem: "DATASET_IMPORTED",
  };
  return mapping[command];
}

export function auditForAssignmentCommand(command: AssignmentWorkflowCommand): AuditAction {
  const mapping: Record<AssignmentWorkflowCommand, AuditAction> = {
    claimAssignment: "ASSIGNMENT_CLAIMED",
    saveDraft: "DRAFT_SAVED",
    submitAssignment: "SUBMISSION_CREATED",
    expireAssignment: "ASSIGNMENT_EXPIRED",
    returnAssignment: "REVIEW_RETURNED",
    acceptAssignment: "REVIEW_ACCEPTED",
    cancelAssignment: "REVIEW_REJECTED",
  };
  return mapping[command];
}

export function auditForSubmissionCommand(command: SubmissionWorkflowCommand): AuditAction {
  const mapping: Record<SubmissionWorkflowCommand, AuditAction> = {
    enqueueAIReview: "AI_REVIEW_ENQUEUED",
    aiReviewPass: "AI_REVIEW_SUCCEEDED",
    aiReviewReturn: "AI_REVIEW_SUCCEEDED",
    aiReviewNeedHuman: "AI_REVIEW_SUCCEEDED",
    aiReviewFailedToHuman: "AI_REVIEW_FAILED_TO_HUMAN",
  };
  return mapping[command];
}

export function auditForAIReviewCommand(command: AIReviewWorkflowCommand): AuditAction {
  const mapping: Record<AIReviewWorkflowCommand, AuditAction> = {
    startAIReviewJob: "AI_REVIEW_STARTED",
    markAIReviewSucceeded: "AI_REVIEW_SUCCEEDED",
    markAIReviewFailed: "AI_REVIEW_FAILED",
    retryAIReviewJob: "AI_REVIEW_FAILED",
    markAIReviewFailedToHuman: "AI_REVIEW_FAILED_TO_HUMAN",
  };
  return mapping[command];
}

export function auditForReviewCommand(command: ReviewWorkflowCommand, reviewPolicy?: ReviewPolicy): AuditAction {
  if (command === "humanReviewPass" && reviewPolicy?.type === "DOUBLE_REVIEW") {
    return "FINAL_REVIEW_REQUESTED";
  }

  const mapping: Record<ReviewWorkflowCommand, AuditAction> = {
    claimReview: "REVIEW_CLAIMED",
    humanReviewPass: "REVIEW_ACCEPTED",
    humanReviewReturn: "REVIEW_RETURNED",
    humanReviewReject: "REVIEW_REJECTED",
    finalReviewPass: "REVIEW_ACCEPTED",
    finalReviewReturn: "REVIEW_RETURNED",
    finalReviewReject: "REVIEW_REJECTED",
  };
  return mapping[command];
}

export function auditForExportCommand(command: ExportWorkflowCommand): AuditAction {
  const mapping: Record<ExportWorkflowCommand, AuditAction> = {
    createExportJob: "EXPORT_CREATED",
    startExportJob: "EXPORT_STARTED",
    markExportSucceeded: "EXPORT_SUCCEEDED",
    markExportFailed: "EXPORT_FAILED",
    cancelExportJob: "EXPORT_CANCELED",
  };
  return mapping[command];
}

export function auditForFileCommand(command: FileWorkflowCommand): AuditAction {
  const mapping: Record<FileWorkflowCommand, AuditAction> = {
    createUploadUrl: "FILE_UPLOAD_URL_CREATED",
    markUploadStarted: "FILE_UPLOAD_STARTED",
    confirmUpload: "FILE_CONFIRMED",
    failUpload: "FILE_UPLOAD_FAILED",
  };
  return mapping[command];
}
