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
import { Badge, Button, Card } from "../ui/primitives";
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
  const workflowSteps = ["任务发布", "模板配置", "标注台", "AI 预审", "人工审核"];
  const roleCards: Array<{
    role: Role;
    title: string;
    description: string;
    tone: "primary" | "success" | "warning";
  }> = [
    {
      role: "OWNER",
      title: "任务所有者",
      description: "创建任务、配置模板、发布到任务市场并查看交付结果。",
      tone: "primary",
    },
    {
      role: "LABELER",
      title: "标注员",
      description: "领取任务，依据动态 Schema 完成标注、保存草稿并提交。",
      tone: "success",
    },
    {
      role: "REVIEWER",
      title: "审核员",
      description: "查看 AI 预审结果，执行人工复核、打回或通过入库。",
      tone: "warning",
    },
  ];

  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="home-hero__copy">
          <Badge tone="primary">MVP Web Shell</Badge>
          <h1 className="home-hero__title">LabelHub</h1>
          <p className="home-hero__subtitle">
            面向动态标注任务的协作工作台：从任务发布、模板配置到标注、AI 预审和人工审核，串起一条可演示的 MVP 流程。
          </p>
          <div className="home-hero__actions">
            <Button tone="primary" onClick={() => onSelect("OWNER")}>
              进入任务发布
            </Button>
            <Button onClick={() => onSelect("LABELER")}>体验标注台</Button>
          </div>
        </div>
        <Card className="home-hero__panel">
          <div className="home-hero__metric">
            <span>角色</span>
            <strong>3</strong>
          </div>
          <div className="home-hero__metric">
            <span>MVP 页面</span>
            <strong>5</strong>
          </div>
          <div className="inset-well">
            <p className="page-subtitle">
              当前先以 Soft UI 呈现可运行 Web UI，SchemaDesigner 暂用 placeholder 等待包导出修复。
            </p>
          </div>
        </Card>
      </section>

      <Card className="workflow-card">
        <div className="workflow-card__header">
          <h2>Workflow</h2>
          <span>任务发布到审核入库</span>
        </div>
        <div className="workflow-stepper">
          {workflowSteps.map((step, index) => (
            <div className="workflow-step" key={step}>
              <span className="workflow-step__index">{index + 1}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </Card>

      <section className="home-role-grid" aria-label="角色入口">
        {roleCards.map((card) => (
          <Card key={card.role} className="home-role-card" interactive>
            <Badge tone={card.tone}>{card.title}</Badge>
            <h2>{card.title}</h2>
            <p>{card.description}</p>
            <Button tone={card.role === "OWNER" ? "primary" : "default"} onClick={() => onSelect(card.role)}>
              进入
            </Button>
          </Card>
        ))}
      </section>
    </main>
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
