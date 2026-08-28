export type TriggerConfig = {
  repo: string;
  triggerType: "workflow_dispatch" | "repository_dispatch";
  workflowId?: string | null;
  eventType?: string | null;
  ref?: string | null;
  inputsJson?: string | null;
};

export type TriggerResult = { ok: true; httpStatus: number } | { ok: false; httpStatus: number; error: string };

function parsePayloadJson(json?: string | null): Record<string, unknown> {
  if (!json || !json.trim()) return {};
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    throw new Error("inputs JSON 解析失败");
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("inputs/payload 必须是 JSON 对象");
  return v as Record<string, unknown>;
}

const HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "User-Agent": "cronjob-scheduler",
});

export async function triggerGithub(
  token: string,
  cfg: TriggerConfig,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<TriggerResult> {
  let url: string;
  let body: Record<string, unknown>;
  try {
    if (cfg.triggerType === "workflow_dispatch") {
      if (!cfg.workflowId) return { ok: false, httpStatus: 0, error: "缺少 workflow 文件名" };
      url = `https://api.github.com/repos/${cfg.repo}/actions/workflows/${cfg.workflowId}/dispatches`;
      body = { ref: cfg.ref || "main", inputs: parsePayloadJson(cfg.inputsJson) };
    } else {
      url = `https://api.github.com/repos/${cfg.repo}/dispatches`;
      body = { event_type: cfg.eventType || "cron", client_payload: parsePayloadJson(cfg.inputsJson) };
    }
  } catch (e) {
    return { ok: false, httpStatus: 0, error: (e as Error).message };
  }
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: HEADERS(token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 204) return { ok: true, httpStatus: 204 };
    let msg = await res.text();
    try {
      msg = (JSON.parse(msg) as { message?: string }).message ?? msg;
    } catch { /* 保留原文 */ }
    return { ok: false, httpStatus: res.status, error: `GitHub API ${res.status}: ${msg}`.slice(0, 500) };
  } catch (e) {
    return { ok: false, httpStatus: 0, error: `请求失败: ${(e as Error).message}`.slice(0, 500) };
  }
}

export async function verifyGithubToken(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; login: string } | { ok: false; error: string }> {
  try {
    const res = await fetchFn("https://api.github.com/user", {
      headers: HEADERS(token),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: `GitHub API ${res.status}` };
    const data = (await res.json()) as { login?: string };
    return { ok: true, login: data.login ?? "" };
  } catch (e) {
    return { ok: false, error: `请求失败: ${(e as Error).message}` };
  }
}
