import type {
  AIReviewJobStatus,
  AssignmentStatus,
  AuditAction,
  DatasetItemStatus,
  ErrorCode,
  ExportJobStatus,
  FileObject,
  FileStatus,
  ID,
  ReviewDecision,
  ReviewStage,
  SubmissionStatus,
  TaskStatus,
  WorkflowCommand,
} from "@labelhub/contracts";

export type WorkflowStatus =
  | TaskStatus
  | DatasetItemStatus
  | AssignmentStatus
  | SubmissionStatus
  | AIReviewJobStatus
  | ExportJobStatus
  | FileStatus;

export type PreviousWorkflowStatus<TStatus extends WorkflowStatus> = TStatus | "NONE";

export type WorkflowSideEffect =
  | {
      type: "CREATE_ASSIGNMENT";
      assignmentStatus: AssignmentStatus;
      datasetItemStatus: DatasetItemStatus;
      schemaVersionId: ID;
    }
  | {
      type: "SAVE_DRAFT";
      assignmentStatus: AssignmentStatus;
      serverRevisionDelta: 1;
    }
  | {
      type: "CREATE_SUBMISSION";
      submissionStatus: SubmissionStatus;
    }
  | {
      type: "CREATE_AI_REVIEW_JOB";
      jobStatus: AIReviewJobStatus;
    }
  | {
      type: "UPDATE_ASSIGNMENT_STATUS";
      status: AssignmentStatus;
    }
  | {
      type: "UPDATE_DATASET_ITEM_STATUS";
      status: DatasetItemStatus;
    }
  | {
      type: "CREATE_REVIEW_RESULT";
      stage: ReviewStage;
      decision: ReviewDecision;
    }
  | {
      type: "CREATE_EXPORT_RESULT_FILE";
      fileId: ID;
    }
  | {
      type: "SCHEDULE_AI_REVIEW_RETRY";
      nextStatus: AIReviewJobStatus;
    }
  | {
      type: "ROUTE_TO_HUMAN_REVIEW";
      submissionStatus: Extract<SubmissionStatus, "NEEDS_HUMAN_REVIEW">;
    }
  | {
      type: "BIND_FILE";
      ownerId: ID;
      ownerType: FileObject["ownerType"];
      purpose: FileObject["purpose"];
    };

export interface TransitionSuccess<
  TCommand extends WorkflowCommand,
  TEntity,
  TStatus extends WorkflowStatus,
> {
  ok: true;
  entity: TEntity;
  command: TCommand;
  previousStatus: PreviousWorkflowStatus<TStatus>;
  nextStatus: TStatus;
  auditAction: AuditAction;
  sideEffects: WorkflowSideEffect[];
}

export interface TransitionFailure<TCommand extends WorkflowCommand, TStatus extends WorkflowStatus> {
  ok: false;
  command: TCommand;
  previousStatus: PreviousWorkflowStatus<TStatus>;
  errorCode: ErrorCode;
  message: string;
  sideEffects: [];
}

export type TransitionResult<
  TCommand extends WorkflowCommand,
  TEntity,
  TStatus extends WorkflowStatus,
> = TransitionSuccess<TCommand, TEntity, TStatus> | TransitionFailure<TCommand, TStatus>;

export interface RetryPolicyContext {
  retryCount: number;
  maxRetries: number;
}

export interface ExportGuardContext {
  allowPatchedAnswers?: boolean;
}

export interface FileOwnershipContext {
  currentAssignmentId?: ID;
  currentUserId: ID;
}
