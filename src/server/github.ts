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

export type WorkflowRunSummary = {
  run_id: number;
  created_at: number;
  /** GitHub 侧最近更新时间；run 已完成时即结束时间 */
  updated_at: number;
  head_branch: string | null;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  html_url: string;
};

export type ListRunsResult = { ok: true; runs: WorkflowRunSummary[] } | { ok: false; error: string };

/** 拉取仓库最近的 workflow runs，用于把 204 的 dispatch 与真实 run 关联起来。
 *  event 可按触发方式过滤（workflow_dispatch / repository_dispatch），减少无关
 *  run 的干扰；返回按 created_at 倒序（GitHub 默认）。 */
export async function listWorkflowRuns(
  token: string,
  cfg: { repo: string; workflowId?: string | null; event?: string | null },
  fetchFn: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<ListRunsResult> {
  const params = new URLSearchParams({ per_page: "20" });
  if (cfg.event) params.set("event", cfg.event);
  const base = cfg.workflowId
    ? `https://api.github.com/repos/${cfg.repo}/actions/workflows/${cfg.workflowId}/runs`
    : `https://api.github.com/repos/${cfg.repo}/actions/runs`;
  try {
    const res = await fetchFn(`${base}?${params}`, {
      headers: HEADERS(token),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      let msg = await res.text();
      try {
        msg = (JSON.parse(msg) as { message?: string }).message ?? msg;
      } catch { /* 保留原文 */ }
      return { ok: false, error: `GitHub API ${res.status}: ${msg}`.slice(0, 500) };
    }
    const data = (await res.json()) as {
      workflow_runs?: Array<{
        id: number;
        created_at: string;
        updated_at: string;
        head_branch: string | null;
        status: string;
        conclusion: string | null;
        html_url: string;
      }>;
    };
    const runs = (data.workflow_runs ?? []).map((r) => ({
      run_id: r.id,
      created_at: Date.parse(r.created_at),
      updated_at: Date.parse(r.updated_at),
      head_branch: r.head_branch,
      status: r.status as WorkflowRunSummary["status"],
      conclusion: r.conclusion,
      html_url: r.html_url,
    }));
    return { ok: true, runs: runs.filter((r) => Number.isFinite(r.created_at)) };
  } catch (e) {
    return { ok: false, error: `请求失败: ${(e as Error).message}` };
  }
}

/** 按 run id 查单条 run：列表分页（per_page=20）覆盖不到的长跑 run 刷新用。 */
export async function getWorkflowRun(
  token: string,
  repo: string,
  runId: number,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<{ ok: true; run: WorkflowRunSummary } | { ok: false; error: string }> {
  try {
    const res = await fetchFn(`https://api.github.com/repos/${repo}/actions/runs/${runId}`, {
      headers: HEADERS(token),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      let msg = await res.text();
      try {
        msg = (JSON.parse(msg) as { message?: string }).message ?? msg;
      } catch { /* 保留原文 */ }
      return { ok: false, error: `GitHub API ${res.status}: ${msg}`.slice(0, 500) };
    }
    const r = (await res.json()) as {
      id: number;
      created_at: string;
      updated_at: string;
      head_branch: string | null;
      status: string;
      conclusion: string | null;
      html_url: string;
    };
    return {
      ok: true,
      run: {
        run_id: r.id,
        created_at: Date.parse(r.created_at),
        updated_at: Date.parse(r.updated_at),
        head_branch: r.head_branch,
        status: r.status as WorkflowRunSummary["status"],
        conclusion: r.conclusion,
        html_url: r.html_url,
      },
    };
  } catch (e) {
    return { ok: false, error: `请求失败: ${(e as Error).message}` };
  }
}
