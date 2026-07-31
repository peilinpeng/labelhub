import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";


afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});


describe("登录页 Demo 模式隔离", () => {
  it("正式模式不展示或预填演示账号密码", () => {
    vi.stubEnv("VITE_DEMO_MODE", "false");
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.queryByText("owner@labelhub.com")).toBeNull();
    expect(screen.queryByText("password123")).toBeNull();
    expect(screen.getByText("选择工作台并使用组织账号登录")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /任务负责人账号/ }));
    expect(screen.getByLabelText("账号")).toHaveValue("");
    expect(screen.getByLabelText("密码")).toHaveValue("");
  });

  it("显式 Demo 模式保留演示快捷入口", () => {
    vi.stubEnv("VITE_DEMO_MODE", "true");
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText("owner@labelhub.com")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /owner@labelhub.com/ }),
    );
    expect(screen.getByLabelText("账号")).toHaveValue("owner@labelhub.com");
    expect(screen.getByLabelText("密码")).toHaveValue("password123");
  });
});
