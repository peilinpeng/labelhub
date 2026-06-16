import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Role } from "../app/routes";

interface RenderRouteOptions {
  /** 初始访问的 URL（含路由参数），例如 "/reviewer/items/sub_123"。 */
  initialPath?: string;
  /** 路由模板，配合 useParams 使用，例如 "/reviewer/items/:submissionId"。不传则直接挂载组件。 */
  routePath?: string;
}

/** 预置登录态：组件经 api/client.ts 的 getAuthHeader 读取 localStorage。 */
export function authenticateAs(role: Role): void {
  localStorage.setItem("labelhub_token", "test-token");
  localStorage.setItem("labelhub_role", role);
  localStorage.setItem(
    "labelhub_actor",
    JSON.stringify({ id: `usr_${role.toLowerCase()}`, role, displayName: role }),
  );
}

/**
 * 在 MemoryRouter 中渲染单个路由组件。
 * 传 routePath/initialPath 时用 Routes 包裹，使被测组件的 useParams 正常工作。
 */
export function renderRoute(ui: ReactElement, options: RenderRouteOptions = {}): RenderResult {
  const { initialPath = "/", routePath } = options;
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      {routePath ? (
        <Routes>
          <Route path={routePath} element={ui} />
        </Routes>
      ) : (
        ui
      )}
    </MemoryRouter>,
  );
}
