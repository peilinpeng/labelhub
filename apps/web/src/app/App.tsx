import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { RoutePath, Role } from "./routes";
import OwnerWorkspace from "../features/owner/OwnerWorkspace";
import OwnerSchemaPage from "../features/owner/OwnerSchemaPage";
import OwnerAIPage from "../features/owner/OwnerAIPage";
import OwnerExportPage from "../features/owner/OwnerExportPage";
import OwnerNewTaskPage from "../features/owner/OwnerNewTaskPage";
import LabelerWorkspace from "../features/labeler/LabelerWorkspace";
import AssignmentPage from "../features/labeler/AssignmentPage";
import ReviewerWorkspace from "../features/reviewer/ReviewerWorkspace";
import ReviewDetailPage from "../features/reviewer/ReviewDetailPage";
import { AppShell, type ShellNavItem } from "../ui/AppShell";
import { Button, Card } from "../ui/primitives";
import "../styles.css";

const roleHome: Record<Role, string> = {
  OWNER: RoutePath.OWNER_TASKS,
  LABELER: RoutePath.LABELER_TASKS,
  REVIEWER: RoutePath.REVIEWER_QUEUE,
};

const shellCopy: Record<Role, { title: string; subtitle: string; navItems: ShellNavItem[] }> = {
  OWNER: {
    title: "任务负责人后台",
    subtitle: "任务管理、模板搭建、发布与交付",
    navItems: [
      { label: "任务管理", path: RoutePath.OWNER_TASKS, end: true },
      { label: "新建任务", path: RoutePath.OWNER_TASKS_NEW },
      { label: "模板搭建", path: "/owner/tasks/task_news_quality/designer" },
      { label: "AI 预审规则", path: "/owner/tasks/task_news_quality/ai-config" },
      { label: "导出中心", path: "/owner/tasks/task_news_quality/export" },
    ],
  },
  LABELER: {
    title: "标注员工作台",
    subtitle: "领取任务、填写答案、保存草稿并提交",
    navItems: [{ label: "任务市场", path: RoutePath.LABELER_TASKS, end: true }],
  },
  REVIEWER: {
    title: "审核与质检",
    subtitle: "AI 预审队列、人工复核与结果入库",
    navItems: [{ label: "审核队列", path: RoutePath.REVIEWER_QUEUE, end: true }],
  },
};

function RoleSelector({ onSelect }: { onSelect: (role: Role) => void }) {
  return (
    <div className="role-select">
      <Card className="role-select__card">
        <h1 className="role-select__title">LabelHub 数据标注平台</h1>
        <p className="role-select__subtitle">选择一个角色进入 MVP demo flow</p>
        <div className="role-select__actions">
          <Button tone="primary" onClick={() => onSelect("OWNER")}>
            任务所有者
          </Button>
          <Button onClick={() => onSelect("LABELER")}>标注员</Button>
          <Button onClick={() => onSelect("REVIEWER")}>审核员</Button>
        </div>
      </Card>
    </div>
  );
}

function AppRoutes({ role }: { role: Role }) {
  return (
    <Routes>
      <Route path={RoutePath.HOME} element={<Navigate to={roleHome[role]} />} />

      <Route path={RoutePath.OWNER_TASKS} element={<OwnerWorkspace role={role} />} />
      <Route path={RoutePath.OWNER_TASKS_NEW} element={<OwnerNewTaskPage role={role} />} />
      <Route path={RoutePath.OWNER_TASKS_DESIGNER} element={<OwnerSchemaPage role={role} />} />
      <Route path={RoutePath.OWNER_TASKS_AI_CONFIG} element={<OwnerAIPage role={role} />} />
      <Route path={RoutePath.OWNER_TASKS_EXPORT} element={<OwnerExportPage role={role} />} />

      <Route path={RoutePath.LABELER_TASKS} element={<LabelerWorkspace role={role} />} />
      <Route path={RoutePath.LABELER_WORKSPACE} element={<AssignmentPage role={role} />} />

      <Route path={RoutePath.REVIEWER_QUEUE} element={<ReviewerWorkspace role={role} />} />
      <Route path={RoutePath.REVIEWER_SUBMISSIONS} element={<ReviewDetailPage role={role} />} />
      <Route path={RoutePath.REVIEWER_SUBMISSIONS_LEGACY} element={<ReviewDetailPage role={role} />} />

      <Route path="*" element={<Navigate to={roleHome[role]} />} />
    </Routes>
  );
}

function App() {
  const [role, setRole] = useState<Role | null>(null);

  if (role === null) {
    return <RoleSelector onSelect={setRole} />;
  }

  const copy = shellCopy[role];

  return (
    <AppShell
      role={role}
      title={copy.title}
      subtitle={copy.subtitle}
      navItems={copy.navItems}
      onSwitchRole={() => setRole(null)}
    >
      <AppRoutes role={role} />
    </AppShell>
  );
}

export default App;
