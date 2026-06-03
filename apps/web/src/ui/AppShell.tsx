import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { Role } from "../app/routes";

export interface ShellNavItem {
  label: string;
  path: string;
  end?: boolean;
}

interface AppShellProps {
  role: Role;
  title: string;
  subtitle: string;
  navItems: ShellNavItem[];
  onSwitchRole(): void;
  children: ReactNode;
}

const roleLabel: Record<Role, string> = {
  OWNER: "Owner",
  LABELER: "Labeler",
  REVIEWER: "Reviewer",
};

const roleUser: Record<Role, { name: string; avatar: string }> = {
  OWNER: { name: "张满", avatar: "张" },
  LABELER: { name: "李雷", avatar: "李" },
  REVIEWER: { name: "王芳", avatar: "王" },
};

function getCurrentNavLabel(pathname: string, navItems: ShellNavItem[]): string {
  const active = navItems
    .filter((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return active?.label ?? navItems[0]?.label ?? "工作台";
}

export function AppShell({ role, title, subtitle: _subtitle, navItems, onSwitchRole, children }: AppShellProps) {
  const location = useLocation();
  const user = roleUser[role];
  const currentNavLabel = getCurrentNavLabel(location.pathname, navItems);

  return (
    <div className="app-shell">
      <header className="app-global-topbar">
        <div className="app-global-topbar__left">
          <div className="app-global-brand" aria-label="LabelHub">
            <span className="app-global-brand__mark" aria-hidden="true" />
            <span>LabelHub</span>
          </div>
          <div className="app-breadcrumb" aria-label="当前位置">
            <span>{title}</span>
            <span aria-hidden="true">/</span>
            <strong>{currentNavLabel}</strong>
          </div>
        </div>
        <div className="app-global-topbar__right">
          <span className="app-user-avatar" aria-hidden="true">
            {user.avatar}
          </span>
          <span className="app-user-name">
            {user.name} · {roleLabel[role]}
          </span>
          <button className="app-account-switch" type="button" onClick={onSwitchRole}>
            切换账号
          </button>
        </div>
      </header>

      <aside className="app-sidebar" aria-label="主导航">
        <div className="app-sidebar__panel">
          <nav className="app-sidebar__section">
            <span className="app-sidebar__eyebrow">{roleLabel[role]} 工作台</span>
            <div className="app-nav">
              {navItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end}
                  className={({ isActive }) =>
                    ["app-nav__link", isActive ? "app-nav__link--active" : ""]
                      .filter(Boolean)
                      .join(" ")
                  }
                >
                  <span className="app-nav__dot" aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </aside>

      <main className="app-main">
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}
