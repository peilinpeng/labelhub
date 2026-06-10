import { useEffect, useRef, useState, type ReactNode } from "react";
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
  OWNER: "任务负责人",
  LABELER: "标注员",
  REVIEWER: "审核员",
};

const roleUser: Record<Role, { name: string; avatar: string }> = {
  OWNER: { name: "刘佳", avatar: "刘" },
  LABELER: { name: "彭佩琳", avatar: "彭" },
  REVIEWER: { name: "罗雄伟", avatar: "罗" },
};

function getCurrentUser(role: Role): { name: string; avatar: string } {
  return roleUser[role];
}

function getCurrentNavLabel(pathname: string, navItems: ShellNavItem[]): string {
  const active = navItems
    .filter((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return active?.label ?? navItems[0]?.label ?? "工作台";
}

export function AppShell({ role, title, subtitle: _subtitle, navItems, onSwitchRole, children }: AppShellProps) {
  const location = useLocation();
  const user = getCurrentUser(role);
  const currentNavLabel = getCurrentNavLabel(location.pathname, navItems);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAccountMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

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
          <div className="app-account-menu-wrap" ref={accountMenuRef}>
            <button
              className="app-account-trigger"
              type="button"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              <span className="app-user-avatar" aria-hidden="true">
                {user.avatar}
              </span>
              <span className="app-account-trigger__text">
                <strong>{user.name}</strong>
                <small>{roleLabel[role]}</small>
              </span>
            </button>
            {accountMenuOpen ? (
              <div className="app-account-menu" role="menu">
                <div className="app-account-menu__header">
                  <span className="app-user-avatar" aria-hidden="true">
                    {user.avatar}
                  </span>
                  <div>
                    <strong>{user.name}</strong>
                    <small>{roleLabel[role]}</small>
                  </div>
                </div>
                <div className="app-account-menu__meta">
                  <span>当前工作台</span>
                  <strong>{title}</strong>
                </div>
                <div className="app-account-menu__meta">
                  <span>当前位置</span>
                  <strong>{currentNavLabel}</strong>
                </div>
                <button
                  className="app-account-switch"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onSwitchRole();
                  }}
                >
                  切换账号
                </button>
              </div>
            ) : null}
          </div>
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
