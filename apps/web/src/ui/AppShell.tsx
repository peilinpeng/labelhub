import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { Role } from "../app/routes";
import { Badge, Button } from "./primitives";

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

export function AppShell({ role, title, subtitle, navItems, onSwitchRole, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="主导航">
        <div className="app-sidebar__panel">
          <div className="app-brand" aria-label="LabelHub">
            <span className="app-brand__mark" aria-hidden="true" />
            <span>LabelHub</span>
          </div>

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
        <header className="app-topbar">
          <div>
            <h1 className="app-topbar__title">{title}</h1>
            <p className="app-topbar__subtitle">{subtitle}</p>
          </div>
          <div className="app-topbar__right">
            <Badge tone="primary">{roleLabel[role]}</Badge>
            <Button tone="ghost" onClick={onSwitchRole}>
              切换账号
            </Button>
          </div>
        </header>
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}
