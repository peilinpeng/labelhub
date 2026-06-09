import type { ApiError } from "@labelhub/contracts";

const ROLE_CREDENTIALS: Record<string, { email: string; password: string }> = {
  OWNER:    { email: "owner@labelhub.test",    password: "Seed@1234" },
  LABELER:  { email: "labeler@labelhub.test",  password: "Seed@1234" },
  REVIEWER: { email: "reviewer@labelhub.test", password: "Seed@1234" },
};

export async function loginForRole(role: string): Promise<void> {
  const creds = ROLE_CREDENTIALS[role];
  if (!creds) return;
  await loginWithCredentials(role, creds.email, creds.password);
}

export async function loginWithCredentials(role: string, email: string, password: string): Promise<void> {
  const res = await fetch("/api/v1/auth/login", {
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
  const response = await fetch(url, { headers: { ...getAuthHeader() } });
  return handleResponse<T>(response);
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
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
  const response = await fetch(url, {
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
  const response = await fetch(url, {
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

/** 上传二进制文件内容（数据集导入用）。不发 Idempotency-Key，避免中间件按写操作缓存。 */
export async function apiUploadBinary(url: string, file: Blob, contentType: string): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType, ...getAuthHeader() },
    body: file,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`文件上传失败 (${response.status}) ${text.slice(0, 200)}`);
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { throw new Error("API returned invalid JSON"); }
  }
  if (!response.ok) {
    // token 失效/未授权：清除本地会话并跳回登录页，而不是让上层静默回退 mock 假数据。
    // 注意：仅 401（后端在线但鉴权失败）触发；后端不可达是 fetch reject，不会进到这里，
    // 因此纯离线/无后端的开发兜底不受影响。
    if (response.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("labelhub_token");
      localStorage.removeItem("labelhub_role");
      localStorage.removeItem("labelhub_actor");
      if (window.location.pathname !== "/") {
        window.location.href = "/";
      }
    }
    const error = data as ApiError | null;
    throw new Error(error?.message ?? `Request failed: ${response.status} ${response.statusText}`);
  }
  return unwrapDataEnvelope(data) as T;
}

function unwrapDataEnvelope(data: unknown): unknown {
  if (data && typeof data === "object" && "data" in data) {
    return (data as { data: unknown }).data;
  }
  return data;
}
