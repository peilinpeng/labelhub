import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw/http";
import { server } from "../test/server";

afterEach(() => vi.unstubAllEnvs());

describe("Mock 页面导航回退", () => {
  it.each(["/", "/labelhub/"])("部署在 %s 时，刷新深链接读取对应应用首页", async (baseUrl) => {
    vi.stubEnv("BASE_URL", baseUrl);
    const requestedPaths: string[] = [];
    server.use(
      http.get("http://localhost/", ({ request }) => {
        requestedPaths.push(new URL(request.url).pathname);
        return HttpResponse.html("<main>根站点</main>");
      }),
      http.get("http://localhost/labelhub/", ({ request }) => {
        requestedPaths.push(new URL(request.url).pathname);
        return HttpResponse.html("<main>LabelHub 子路径站点</main>");
      }),
    );

    const response = await fetch(`http://localhost${baseUrl}owner/tasks`, {
      headers: { Accept: "text/html" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe(
      baseUrl === "/" ? "<main>根站点</main>" : "<main>LabelHub 子路径站点</main>",
    );
    expect(requestedPaths).toEqual([baseUrl]);
  });
});
