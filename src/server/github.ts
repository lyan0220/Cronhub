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
  retryDelayMs = 1_000,
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

  const once = async (): Promise<TriggerResult> => {
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
  };

  let result = await once();
  // 瞬时失败（网络抖动 / 429 / 5xx）重试一次。dispatch 是 POST，「请求已达
  // GitHub 但响应丢失」时重试会重复触发一次——对定时任务通常无害（最坏多跑
  // 一轮），换来的是一次抖动不至于丢掉整个调度周期。4xx 是明确失败不重试；
  // 403 的限速窗口远大于重试间隔，重试同样没有意义，一并排除。
  if (!result.ok && (result.httpStatus === 0 || result.httpStatus === 429 || result.httpStatus >= 500)) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    result = await once();
  }
  return result;
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
