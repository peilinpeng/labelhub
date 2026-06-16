export enum RoutePath {
  HOME = "/",
  
  OWNER_TASKS = "/owner/tasks",
  OWNER_TASKS_NEW = "/owner/tasks/new",
  OWNER_AI_CONFIG = "/owner/ai-config",
  OWNER_TASK_DETAIL = "/owner/tasks/:taskId",
  OWNER_TASKS_DATA = "/owner/tasks/:taskId/data",
  OWNER_TASKS_DATASET = "/owner/tasks/:taskId/dataset",
  OWNER_TASKS_DESIGNER = "/owner/tasks/:taskId/designer",
  OWNER_TASKS_AI_PRECHECK = "/owner/tasks/:taskId/ai-precheck",
  OWNER_TASKS_AI_CONFIG = "/owner/tasks/:taskId/ai-config",
  OWNER_TASKS_EXPORT = "/owner/tasks/:taskId/export",
  OWNER_ANALYTICS = "/owner/analytics",

  LABELER_TASKS = "/labeler/tasks",
  LABELER_WORKSPACE = "/labeler/workspace/:assignmentId",
  LABELER_SUBMISSIONS = "/labeler/submissions",
  
  REVIEWER_QUEUE = "/reviewer/items",
  REVIEWER_SUBMISSIONS = "/reviewer/items/:submissionId",
  REVIEWER_SUBMISSIONS_LEGACY = "/reviewer/submissions/:submissionId",
}

export type Role = "OWNER" | "LABELER" | "REVIEWER";

export interface RouteConfig {
  path: string;
  role: Role;
  label: string;
}

export const roleRoutes: Record<Role, RouteConfig[]> = {
  OWNER: [
    { path: RoutePath.OWNER_TASKS, role: "OWNER", label: "任务列表" },
    { path: RoutePath.OWNER_TASKS_NEW, role: "OWNER", label: "新建任务" },
    { path: RoutePath.OWNER_AI_CONFIG, role: "OWNER", label: "AI预审设置" },
    { path: RoutePath.OWNER_TASK_DETAIL, role: "OWNER", label: "任务详情" },
    { path: RoutePath.OWNER_TASKS_DATA, role: "OWNER", label: "数据管理" },
    { path: RoutePath.OWNER_TASKS_DATASET, role: "OWNER", label: "数据集" },
    { path: RoutePath.OWNER_TASKS_DESIGNER, role: "OWNER", label: "模板设计" },
    { path: RoutePath.OWNER_TASKS_AI_PRECHECK, role: "OWNER", label: "AI预审配置" },
    { path: RoutePath.OWNER_TASKS_AI_CONFIG, role: "OWNER", label: "AI配置" },
    { path: RoutePath.OWNER_TASKS_EXPORT, role: "OWNER", label: "导出" },
  ],
  LABELER: [
    { path: RoutePath.LABELER_TASKS, role: "LABELER", label: "任务市场" },
    { path: RoutePath.LABELER_WORKSPACE, role: "LABELER", label: "标注工作台" },
    { path: RoutePath.LABELER_SUBMISSIONS, role: "LABELER", label: "我的提交" },
  ],
  REVIEWER: [
    { path: RoutePath.REVIEWER_QUEUE, role: "REVIEWER", label: "审核队列" },
    { path: RoutePath.REVIEWER_SUBMISSIONS, role: "REVIEWER", label: "审核详情" },
  ],
};
