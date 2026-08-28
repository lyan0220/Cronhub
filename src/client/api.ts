type ApiResp<T> = { ok: true; data: T } | { ok: false; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    location.href = "/login";
    throw new Error("未登录");
  }
  const json = (await res.json().catch(() => ({ ok: false, error: "响应解析失败" }))) as ApiResp<T>;
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

export const get = <T,>(path: string) => request<T>(path);
export const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });

export const fmtTime = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "-";
