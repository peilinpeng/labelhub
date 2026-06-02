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
    const data = await res.json();
    localStorage.setItem("labelhub_token", data.token);
    localStorage.setItem("labelhub_role", role);
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

async function handleResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { throw new Error("API returned invalid JSON"); }
  }
  if (!response.ok) {
    const error = data as ApiError | null;
    throw new Error(error?.message ?? `Request failed: ${response.status} ${response.statusText}`);
  }
  return data as T;
}
