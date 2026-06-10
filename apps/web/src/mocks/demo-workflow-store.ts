import type { AnswerPayload, Submission } from "@labelhub/contracts";

const STORAGE_KEY = "labelhub.demo.workflow.v1";

export const DEMO_ASSIGNMENT_ID = "asn_1001";
export const DEMO_SUBMISSION_ID = "sub_1001";
export const DEMO_TASK_ID = "task_news_quality";
export const DEMO_ITEM_ID = "item_news_1";
export const DEMO_SCHEMA_VERSION_ID = "sv_news_quality_1";

type DemoAssignmentStatus = "CLAIMED" | "DRAFTING" | "SUBMITTED" | "RETURNED" | "ACCEPTED";
type DemoSubmissionStatus = "NEEDS_HUMAN_REVIEW" | "ACCEPTED" | "RETURNED" | "REJECTED";

interface DemoWorkflowState {
  assignmentStatus: DemoAssignmentStatus;
  submissionStatus: DemoSubmissionStatus;
  answers: AnswerPayload;
  lastMessage?: string;
  updatedAt: string;
}

const defaultAnswers: AnswerPayload = {
  newsCategory: "technology",
  qualityScore: "2",
  issueTags: ["missing_source", "unclear_fact"],
  factCheckNote: "原文没有提供完整统计口径，需要补充来源。",
  rewriteSuggestion: "建议补充报告名称、统计周期和第三方验证来源。",
};

function now(): string {
  return new Date().toISOString();
}

function defaultState(): DemoWorkflowState {
  return {
    assignmentStatus: "CLAIMED",
    submissionStatus: "NEEDS_HUMAN_REVIEW",
    answers: defaultAnswers,
    updatedAt: now(),
  };
}

function readState(): DemoWorkflowState {
  if (typeof window === "undefined") return defaultState();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    return { ...defaultState(), ...(JSON.parse(raw) as Partial<DemoWorkflowState>) };
  } catch {
    return defaultState();
  }
}

function writeState(nextState: DemoWorkflowState): DemoWorkflowState {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }
  return nextState;
}

export function getDemoWorkflowState(): DemoWorkflowState {
  return readState();
}

export function claimDemoAssignment(): DemoWorkflowState {
  return writeState({
    ...readState(),
    assignmentStatus: "CLAIMED",
    updatedAt: now(),
  });
}

export function submitDemoAssignment(answers: AnswerPayload): DemoWorkflowState {
  return writeState({
    ...readState(),
    assignmentStatus: "SUBMITTED",
    submissionStatus: "NEEDS_HUMAN_REVIEW",
    answers: Object.keys(answers).length > 0 ? answers : defaultAnswers,
    lastMessage: "提交成功，已进入 AI 预审 / 人工审核队列。",
    updatedAt: now(),
  });
}

export function reviewDemoSubmission(decision: "PASS" | "RETURN" | "REJECT"): DemoWorkflowState {
  const submissionStatus: DemoSubmissionStatus =
    decision === "PASS" ? "ACCEPTED" : decision === "RETURN" ? "RETURNED" : "REJECTED";
  const assignmentStatus: DemoAssignmentStatus =
    decision === "PASS" ? "ACCEPTED" : decision === "RETURN" ? "RETURNED" : "RETURNED";
  return writeState({
    ...readState(),
    assignmentStatus,
    submissionStatus,
    lastMessage: decision === "PASS" ? "审核通过，结果已入库。" : "审核已打回，等待标注员修订。",
    updatedAt: now(),
  });
}

export function applyDemoSubmissionState(submission: Submission): Submission {
  if (submission.id !== DEMO_SUBMISSION_ID) return submission;
  const state = readState();
  return {
    ...submission,
    answers: Object.keys(state.answers).length > 0 ? state.answers : submission.answers,
    status: state.submissionStatus,
    updatedAt: state.updatedAt,
  };
}

export function getDemoSubmissionFallback(): Submission {
  const state = readState();
  return {
    id: DEMO_SUBMISSION_ID,
    assignmentId: DEMO_ASSIGNMENT_ID,
    taskId: DEMO_TASK_ID,
    itemId: DEMO_ITEM_ID,
    labelerId: "usr_labeler",
    schemaVersionId: DEMO_SCHEMA_VERSION_ID,
    attemptNo: 1,
    answers: state.answers,
    status: state.submissionStatus,
    validationSnapshot: {
      valid: true,
      errors: [],
      warnings: [],
    },
    createdAt: "2026-05-28T12:20:00.000Z",
    updatedAt: state.updatedAt,
  };
}
