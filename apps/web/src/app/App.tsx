import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
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
import { loginForRole } from "../api/client";

const roleHome: Record<Role, string> = {
  OWNER: RoutePath.OWNER_TASKS,
  LABELER: RoutePath.LABELER_TASKS,
  REVIEWER: RoutePath.REVIEWER_QUEUE,
};

function inferRoleFromPath(pathname: string): Role | null {
  if (pathname.startsWith("/owner/")) return "OWNER";
  if (pathname.startsWith("/labeler/")) return "LABELER";
  if (pathname.startsWith("/reviewer/")) return "REVIEWER";
  return null;
}

// 仅在 localStorage 已有 token 时才从 URL 恢复角色（session 续期），否则强制走登录流程
function inferRoleFromPathIfAuthenticated(pathname: string): Role | null {
  if (!localStorage.getItem("labelhub_token")) return null;
  return inferRoleFromPath(pathname);
}

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
  const workflowSteps: Array<{
    title: string;
    description: string;
    role: Role;
  }> = [
    { title: "任务发布", description: "创建任务并确认发布信息", role: "OWNER" },
    { title: "模板配置", description: "进入模板搭建与预览", role: "OWNER" },
    { title: "标注台", description: "领取任务并提交答案", role: "LABELER" },
    { title: "AI 预审", description: "查看结构化预审结论", role: "REVIEWER" },
    { title: "人工审核", description: "复核后通过或打回", role: "REVIEWER" },
  ];
  const roleCards: Array<{
    role: Role;
    title: string;
    description: string;
    meta: string;
    tone: "primary" | "success" | "warning";
  }> = [
    {
      role: "OWNER",
      title: "任务所有者",
      description: "创建任务、配置模板、发布任务。",
      meta: "推荐起点",
      tone: "primary",
    },
    {
      role: "LABELER",
      title: "标注员",
      description: "领取任务、完成标注、提交草稿。",
      meta: "标注工作台",
      tone: "success",
    },
    {
      role: "REVIEWER",
      title: "审核员",
      description: "查看 AI 预审、人工复核、通过/打回。",
      meta: "质检与复核",
      tone: "warning",
    },
  ];
  const demoMetrics = [
    { label: "已提交", value: "342" },
    { label: "AI 预审通过率", value: "84%" },
    { label: "待人工审核", value: "37" },
    { label: "可导出数据", value: "289" },
  ];

  return (
    <main className="control-center">
      <section className="control-header">
        <div>
          <Badge tone="primary">MVP Demo Control Center</Badge>
          <h1>LabelHub</h1>
          <p className="control-header__subtitle">AI 数据标注协作工作台</p>
          <p className="control-header__copy">
            从任务发布、模板配置到标注、AI 预审和人工审核的 MVP 演示入口。
          </p>
        </div>
        <Button tone="primary" onClick={() => onSelect("OWNER")}>
          从任务发布开始
        </Button>
      </section>

      <section className="demo-overview" aria-label="Demo 状态总览">
        <Card className="demo-kpi-card">
          <span>角色</span>
          <strong>3</strong>
        </Card>
        <Card className="demo-kpi-card">
          <span>MVP 页面</span>
          <strong>5</strong>
        </Card>
        <Card className="demo-kpi-card demo-kpi-card--wide">
          <span>当前任务</span>
          <strong>新闻质量标注</strong>
        </Card>
        <Card className="demo-kpi-card demo-kpi-card--wide">
          <span>流程状态</span>
          <strong>AI 预审中 / 待人工审核</strong>
        </Card>
      </section>

      <Card className="control-workflow-card">
        <div className="control-section-heading">
          <h2>MVP 演示流程</h2>
          <span>按顺序体验核心路径</span>
        </div>
        <div className="control-stepper">
          {workflowSteps.map((step, index) => (
            <div className="control-step" key={step.title}>
              <span className="control-step__index">{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </div>
              <Button onClick={() => onSelect(step.role)}>进入</Button>
            </div>
          ))}
        </div>
      </Card>

      <section className="control-grid">
        <div className="role-entry-grid" aria-label="角色入口">
          {roleCards.map((card) => (
            <Card
              key={card.role}
              className={["role-entry-card", card.role === "OWNER" ? "role-entry-card--recommended" : ""]
                .filter(Boolean)
                .join(" ")}
              interactive
            >
              <Badge tone={card.tone}>{card.title}</Badge>
              <h2>{card.title}</h2>
              <p>{card.description}</p>
              <span className="role-entry-card__meta">{card.meta}</span>
              <Button tone={card.role === "OWNER" ? "primary" : "default"} onClick={() => onSelect(card.role)}>
                进入
              </Button>
            </Card>
          ))}
        </div>

        <Card className="demo-data-card">
          <div className="control-section-heading">
            <h2>当前 Demo 数据</h2>
            <span>新闻质量标注</span>
          </div>
          <div className="demo-data-list">
            {demoMetrics.map((metric) => (
              <div className="demo-data-row" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        </Card>
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
  const location = useLocation();
  // 修复：初始化时检查 token，无 token 则强制走 RoleSelector 登录流程
  const [role, setRole] = useState<Role | null>(() => inferRoleFromPathIfAuthenticated(location.pathname));

  useEffect(() => {
    const routeRole = inferRoleFromPath(location.pathname);
    if (routeRole && routeRole !== role) {
      setRole(routeRole);
    }
  }, [location.pathname, role]);

  if (role === null) {
    return (
      <RoleSelector
        onSelect={async (r) => {
          // 修复：捕获登录异常，失败时提示用户，不调用 setRole
          try {
            await loginForRole(r);
            setRole(r);
          } catch (e) {
            alert(`登录失败：${e instanceof Error ? e.message : "网络错误，请检查后端是否运行在 localhost:3000"}`);
          }
        }}
      />
    );
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
