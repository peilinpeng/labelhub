/// <reference types="vite/client" />

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./app/App";

async function bootstrap() {
  const baseUrl = import.meta.env.BASE_URL;
  const routerBasename = baseUrl === "/" ? undefined : baseUrl.replace(/\/$/, "");

  if (import.meta.env.VITE_ENABLE_MSW === "true") {
    const { worker } = await import("./mocks/browser");
    await worker.start({
      serviceWorker: {
        url: `${baseUrl}mockServiceWorker.js`,
        options: { scope: baseUrl },
      },
      onUnhandledRequest(request, print) {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/api/")) {
          print.error();
        }
      },
    });
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter basename={routerBasename} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}
bootstrap().catch((error) => {
  console.error("应用启动失败：", error);
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `<main class="state-panel" style="margin:24px;">应用启动失败，请刷新页面或检查本地服务。</main>`;
  }
});
