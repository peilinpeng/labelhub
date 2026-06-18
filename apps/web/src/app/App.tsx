import { useEffect, useState, type FormEvent } from "react";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { RoutePath, Role } from "./routes";
import OwnerWorkspace from "../features/owner/OwnerWorkspace";
import OwnerSchemaPage from "../features/owner/OwnerSchemaPage";
import OwnerAIPage from "../features/owner/OwnerAIPage";
import OwnerExportPage from "../features/owner/OwnerExportPage";
import OwnerNewTaskPage from "../features/owner/OwnerNewTaskPage";
import OwnerTaskDetailPage from "../features/owner/OwnerTaskDetailPage";
import LabelerWorkspace from "../features/labeler/LabelerWorkspace";
import AssignmentPage from "../features/labeler/AssignmentPage";
import ReviewerWorkspace from "../features/reviewer/ReviewerWorkspace";
import ReviewDetailPage from "../features/reviewer/ReviewDetailPage";
import { AppShell, type ShellNavItem } from "../ui/AppShell";
import { Badge, Button, Card } from "../ui/primitives";
import "../styles.css";
import { loginWithCredentials } from "../api/client";

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
    navItems: [
      { label: "任务市场", path: RoutePath.LABELER_TASKS, end: true },
      { label: "我的提交", path: RoutePath.LABELER_SUBMISSIONS },
    ],
  },
  REVIEWER: {
    title: "审核与质检",
    subtitle: "AI 预审队列、人工复核与结果入库",
    navItems: [{ label: "审核队列", path: RoutePath.REVIEWER_QUEUE, end: true }],
  },
};

function LoginPage({ onLogin }: { onLogin: (role: Role, email: string, password: string) => Promise<void> }) {
  const accounts: Array<{
    role: Role;
    title: string;
    username: string;
  }> = [
    {
      role: "OWNER",
      title: "任务负责人账号",
      username: "owner@labelhub.test",
    },
    {
      role: "LABELER",
      title: "标注员账号",
      username: "labeler@labelhub.test",
    },
    {
      role: "REVIEWER",
      title: "人工审核账号",
      username: "reviewer@labelhub.test",
    },
  ];
  const [activeAccount, setActiveAccount] = useState<(typeof accounts)[number] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const openLoginDialog = (account: (typeof accounts)[number]) => {
    setActiveAccount(account);
    setEmail(account.username);
    setPassword("");
    setLoginError(null);
  };

  const closeLoginDialog = () => {
    if (pendingRole !== null) return;
    setActiveAccount(null);
    setPassword("");
    setLoginError(null);
  };

  const handleAccountLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeAccount) return;
    try {
      setPendingRole(activeAccount.role);
      setLoginError(null);
      await onLogin(activeAccount.role, email.trim(), password);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败，请稍后重试。");
    } finally {
      setPendingRole(null);
    }
  };

  return (
    <main className="login-page">
      <div className="login-shell">
        <section className="login-intro" aria-label="产品介绍">
          <div className="login-brand">
            <span className="login-brand__mark" aria-hidden="true" />
            <span>LabelHub</span>
          </div>
          <div>
            <h1>AI 数据标注协作工作台</h1>
            <p>统一管理标注任务、模板配置、数据标注、AI 预审与人工复核。</p>
          </div>
        </section>

        <Card className="login-card">
          <div className="login-card__header">
            <h2>登录 LabelHub</h2>
            <p>选择一个测试账号进入对应工作台</p>
          </div>

          <div className="login-account-list" aria-label="测试账号">
            {accounts.map((account) => (
              <button
                className="login-account"
                disabled={pendingRole !== null}
                key={account.role}
                type="button"
                onClick={() => openLoginDialog(account)}
              >
                <span>
                  <strong>{account.title}</strong>
                  <small>{account.username}</small>
                </span>
                <em>登录</em>
              </button>
            ))}
          </div>
        </Card>

        {activeAccount ? (
          <div className="login-dialog-backdrop" role="presentation">
            <Card className="login-dialog" role="dialog" aria-modal="true" aria-labelledby="login-dialog-title">
              <div className="login-dialog__header">
                <div>
                  <span>{activeAccount.title}</span>
                  <h2 id="login-dialog-title">账号登录</h2>
                </div>
                <button type="button" onClick={closeLoginDialog} aria-label="关闭登录窗口">
                  ×
                </button>
              </div>

              <form className="login-form" onSubmit={(event) => void handleAccountLogin(event)}>
                <label>
                  <span>账号</span>
                  <input
                    autoComplete="username"
                    className="login-form-input"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label>
                  <span>密码</span>
                  <input
                    autoComplete="current-password"
                    className="login-form-input"
                    placeholder="请输入密码"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>

                {loginError ? <div className="login-error" role="alert">{loginError}</div> : null}

                <div className="login-dialog__actions">
                  <Button type="button" onClick={closeLoginDialog}>
                    取消
                  </Button>
                  <Button type="submit" tone="primary" disabled={pendingRole !== null || !email.trim() || !password}>
                    {pendingRole === activeAccount.role ? "登录中..." : "登录"}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <Badge tone="warning">Placeholder</Badge>
          <h2 className="page-title">{title}</h2>
          <p className="page-subtitle">{description}</p>
        </div>
      </div>
      <Card className="state-panel">
        当前页面已保留稳定路由，后续可在不影响演示链路的前提下继续补齐功能。
      </Card>
    </div>
  );
}

function AppRoutes({ role }: { role: Role }) {
  return (
    <Routes>
      <Route path={RoutePath.OWNER_TASKS} element={<OwnerWorkspace role={role} />} />
      <Route path={RoutePath.OWNER_TASKS_NEW} element={<OwnerNewTaskPage role={role} />} />
      <Route path={RoutePath.OWNER_TASK_DETAIL} element={<OwnerTaskDetailPage role={role} />} />
      <Route path={RoutePath.OWNER_TASKS_DESIGNER} element={<OwnerSchemaPage role={role} />} />
      <Route path={RoutePath.OWNER_TASKS_AI_CONFIG} element={<OwnerAIPage role={role} />} />
      <Route path={RoutePath.OWNER_TASKS_EXPORT} element={<OwnerExportPage role={role} />} />

      <Route path={RoutePath.LABELER_TASKS} element={<LabelerWorkspace role={role} />} />
      <Route path={RoutePath.LABELER_WORKSPACE} element={<AssignmentPage role={role} />} />
      <Route
        path={RoutePath.LABELER_SUBMISSIONS}
        element={
          <PlaceholderPage
            title="我的提交"
            description="标注员提交列表尚未完成。当前流程可从任务市场领取任务并进入标注工作台。"
          />
        }
      />

      <Route path={RoutePath.REVIEWER_QUEUE} element={<ReviewerWorkspace role={role} />} />
      <Route path={RoutePath.REVIEWER_SUBMISSIONS} element={<ReviewDetailPage role={role} />} />
      <Route path={RoutePath.REVIEWER_SUBMISSIONS_LEGACY} element={<ReviewDetailPage role={role} />} />

      <Route
        path="*"
        element={
          <PlaceholderPage
            title="页面未完成"
            description={`当前 ${role} 路由尚未接入页面组件。请使用侧边栏进入已完成的工作区页面。`}
          />
        }
      />
    </Routes>
  );
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role | null>(() => inferRoleFromPath(location.pathname));

  const handleRoleSelect = async (nextRole: Role, email: string, password: string): Promise<void> => {
    try {
      await loginWithCredentials(nextRole, email, password);
    } catch (error) {
      console.warn("Login API unavailable, entering workspace with local session.", error);
      localStorage.setItem("labelhub_role", nextRole);
    }
    setRole(nextRole);
    navigate(roleHome[nextRole]);
  };

  useEffect(() => {
    const routeRole = inferRoleFromPath(location.pathname);
    if (routeRole && routeRole !== role) {
      setRole(routeRole);
    }
  }, [location.pathname, role]);

  if (location.pathname === RoutePath.HOME) {
    return (
      <LoginPage
        onLogin={handleRoleSelect}
      />
    );
  }

  if (role === null) {
    return (
      <LoginPage
        onLogin={handleRoleSelect}
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
      onSwitchRole={() => {
        localStorage.removeItem("labelhub_token");
        localStorage.removeItem("labelhub_role");
        setRole(null);
        navigate(RoutePath.HOME);
      }}
    >
      <AppRoutes role={role} />
    </AppShell>
  );
}

export default App;
