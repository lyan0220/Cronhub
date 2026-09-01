type ApiResp<T> = { ok: true; data: T } | { ok: false; error: string };

// 网络挂死（弱网、代理黑洞）时骨架屏会永远转下去，30s 是耐心的上限
const TIMEOUT_MS = 30_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    // 网络断开、DNS 失败或超时：给一句可读文案，而不是把裸 TypeError 冒给 toast
    throw new Error("网络异常或请求超时，请稍后重试");
  }
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

/** 统一的报错文案提取：catch 到的未必是 Error（Promise.reject 可以扔任何值）。 */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string" && e) return e;
  return "操作失败，请重试";
}
