import type { ApiError } from "@labelhub/contracts";

/**
 * 携带 HTTP 状态码与后端错误码的请求错误。
 * 调用方可据此区分 409（REVISION_CONFLICT）、422（VALIDATION_FAILED）、
 * 502（LLM_ASSIST_FAILED）等，做就地的软提示与恢复，而非一律当未知错误。
 * 仍是 Error 子类，原有 `instanceof Error` / `.message` 的调用方不受影响。
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

const ROLE_CREDENTIALS: Record<string, { email: string; password: string }> = {
  OWNER:    { email: "owner@labelhub.test",    password: "Seed@1234" },
  LABELER:  { email: "labeler@labelhub.test",  password: "Seed@1234" },
  REVIEWER: { email: "reviewer@labelhub.test", password: "Seed@1234" },
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function apiUrl(path: string): string {
  if (!API_BASE_URL || /^https?:\/\//.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (API_BASE_URL.endsWith("/api/v1") && normalizedPath.startsWith("/api/v1/")) {
    return API_BASE_URL + normalizedPath.slice("/api/v1".length);
  }
  return API_BASE_URL + normalizedPath;
}

export async function loginForRole(role: string): Promise<void> {
  const creds = ROLE_CREDENTIALS[role];
  if (!creds) return;
  await loginWithCredentials(role, creds.email, creds.password);
}

export async function loginWithCredentials(role: string, email: string, password: string): Promise<void> {
  const res = await fetch(apiUrl("/api/v1/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) {
    const data = unwrapDataEnvelope(await res.json()) as {
      token?: string;
      accessToken?: string;
      actor?: { role?: string };
      user?: { role?: string };
    };
    const token = data.token ?? data.accessToken;
    if (!token) throw new Error("Login succeeded but no token was returned.");
    const authenticatedRole = data.actor?.role ?? data.user?.role;
    if (authenticatedRole && authenticatedRole !== role) {
      throw new Error("该账号角色与所选工作台不一致，请选择正确的账号入口。");
    }
    localStorage.setItem("labelhub_token", token);
    localStorage.setItem("labelhub_role", authenticatedRole ?? role);
    if (data.actor) localStorage.setItem("labelhub_actor", JSON.stringify(data.actor));
  } else {
    let message = `登录失败 (${res.status})`;
    try {
      const err = await res.json() as ApiError;
      if (err?.message) message = err.message;
    } catch {
      if (res.status >= 500) {
        message = "登录服务未连接，请确认后端 API 已在 localhost:3000 运行。";
      }
    }
    throw new Error(message);
  }
}

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("labelhub_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(apiUrl(url), { headers: { ...getAuthHeader() } });
  return handleResponse<T>(response);
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      ...getAuthHeader(),
    },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(response);
}

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(url), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      ...getAuthHeader(),
    },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(response);
}

export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(url), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      ...getAuthHeader(),
    },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(response);
}

export async function apiDelete<T = void>(url: string): Promise<T> {
  const response = await fetch(apiUrl(url), {
    method: "DELETE",
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
      ...getAuthHeader(),
    },
  });
  return handleResponse<T>(response);
}

/** 上传二进制文件内容（数据集导入用）。不发 Idempotency-Key，避免中间件按写操作缓存。 */
export async function apiUploadBinary(url: string, file: Blob, contentType: string): Promise<void> {
  const response = await fetch(apiUrl(url), {
    method: "POST",
    headers: { "Content-Type": contentType, ...getAuthHeader() },
    body: file,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`文件上传失败 (${response.status}) ${text.slice(0, 200)}`);
  }
}

/**
 * 下载二进制制品（导出文件等）。带认证，失败时抛 ApiRequestError 供调用方就地提示。
 * 返回 blob 与从 Content-Disposition 解析出的文件名（可能为 null）。
 */
export async function apiGetBlob(url: string): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetch(apiUrl(url), { headers: { ...getAuthHeader() } });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message: string | undefined;
    let code: string | undefined;
    try {
      const err = JSON.parse(text) as ApiError;
      message = err?.message;
      code = err?.code;
    } catch {
      // 非 JSON 错误体：保留默认提示。
    }
    throw new ApiRequestError(
      message ?? `Request failed: ${response.status} ${response.statusText}`,
      response.status,
      code,
    );
  }
  const blob = await response.blob();
  return { blob, filename: parseContentDispositionFilename(response.headers.get("content-disposition")) };
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try { return decodeURIComponent(utf8[1].trim()); } catch { /* fall through */ }
  }
  const quoted = /filename="?([^";]+)"?/i.exec(header);
  return quoted?.[1]?.trim() ?? null;
}

async function handleResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { throw new Error("API returned invalid JSON"); }
  }
  if (!response.ok) {
    // 单个接口的 401 不再清会话并强制跳回登录页：那会让某个端点的鉴权/路由问题
    // （而非整体会话失效）把用户从当前页弹回首页（见 OwnerAIPage 拉取 review-config）。
    // 这里只把 401 当普通错误抛出，由各调用方就地做软提示（OwnerAIPage 等已有 catch 处理）；
    // 真正的会话失效会导致所有请求 401，登录态在下次角色校验时自然回到登录流程。
    const error = data as ApiError | null;
    throw new ApiRequestError(
      error?.message ?? `Request failed: ${response.status} ${response.statusText}`,
      response.status,
      error?.code,
    );
  }
  return unwrapDataEnvelope(data) as T;
}

function unwrapDataEnvelope(data: unknown): unknown {
  if (data && typeof data === "object" && "data" in data) {
    return (data as { data: unknown }).data;
  }
  return data;
}
