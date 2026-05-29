export enum RoutePath {
  HOME = "/",
  
  OWNER_TASKS = "/owner/tasks",
  OWNER_TASKS_NEW = "/owner/tasks/new",
  OWNER_TASKS_DESIGNER = "/owner/tasks/:taskId/designer",
  OWNER_TASKS_AI_CONFIG = "/owner/tasks/:taskId/ai-config",
  OWNER_TASKS_EXPORT = "/owner/tasks/:taskId/export",
  
  LABELER_TASKS = "/labeler/tasks",
  LABELER_WORKSPACE = "/labeler/workspace/:assignmentId",
  
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
    { path: RoutePath.OWNER_TASKS_DESIGNER, role: "OWNER", label: "模板设计" },
    { path: RoutePath.OWNER_TASKS_AI_CONFIG, role: "OWNER", label: "AI配置" },
    { path: RoutePath.OWNER_TASKS_EXPORT, role: "OWNER", label: "导出" },
  ],
  LABELER: [
    { path: RoutePath.LABELER_TASKS, role: "LABELER", label: "任务市场" },
    { path: RoutePath.LABELER_WORKSPACE, role: "LABELER", label: "标注工作台" },
  ],
  REVIEWER: [
    { path: RoutePath.REVIEWER_QUEUE, role: "REVIEWER", label: "审核队列" },
    { path: RoutePath.REVIEWER_SUBMISSIONS, role: "REVIEWER", label: "审核详情" },
  ],
};
