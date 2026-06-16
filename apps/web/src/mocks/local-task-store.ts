import type { ID, Task } from "@labelhub/contracts";

const LOCAL_TASKS_KEY = "labelhub.local.tasks.v1";

type DistributionType = "FIRST_COME_FIRST_SERVED" | "ASSIGNMENT" | "QUOTA_CLAIM";
type ReviewPolicyType = "SINGLE_REVIEW" | "DOUBLE_REVIEW";

interface CreateLocalTaskInput {
  title: string;
  description: string;
  quotaTotal: number;
  distributionType: DistributionType;
  reviewPolicyType: ReviewPolicyType;
  assigneeIds: ID[];
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function readTasks(): Task[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_TASKS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks: Task[]): void {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
}

export function listLocalTasks(): Task[] {
  return readTasks();
}

export function findLocalTaskById(taskId: string | undefined): Task | undefined {
  if (!taskId) {
    return undefined;
  }
  return readTasks().find((task) => task.id === taskId);
}

export function createLocalPublishedTask(input: CreateLocalTaskInput): Task {
  const now = new Date().toISOString();
  const safeTitle = input.title.trim() || "未命名任务";
  const task: Task = {
    id: `task_local_${Date.now()}` as ID,
    title: safeTitle,
    description: input.description.trim() || "请在模板配置页补充任务说明与标注要求。",
    tags: ["本地任务"],
    rewardRule: {
      unit: "PER_ACCEPTED_ITEM",
      amount: 1,
      currency: "CNY",
    },
    quota: {
      total: input.quotaTotal,
      perLabeler: 20,
    },
    deadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    distributionStrategy:
      input.distributionType === "FIRST_COME_FIRST_SERVED"
        ? { type: "FIRST_COME_FIRST_SERVED" }
        : input.distributionType === "ASSIGNMENT"
          ? { type: "ASSIGNMENT", assigneeIds: input.assigneeIds }
          : { type: "QUOTA_CLAIM", claimBatchSize: 10 },
    reviewPolicy:
      input.reviewPolicyType === "SINGLE_REVIEW"
        ? { type: "SINGLE_REVIEW" }
        : { type: "DOUBLE_REVIEW", requireFinalReview: true },
    status: "PUBLISHED",
    ownerId: "usr_owner" as ID,
    createdAt: now,
    updatedAt: now,
  };

  const existingTasks = readTasks().filter((item) => item.id !== task.id);
  writeTasks([task, ...existingTasks]);
  return task;
}
