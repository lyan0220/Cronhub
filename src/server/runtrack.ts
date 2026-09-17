// GitHub workflow 真实执行结果追踪。dispatch API 只返回 204（HTTP 层成功），
// workflow 是否真的跑完、成败与否由本模块轮询 GitHub Runs API 回填到 runs 表的
// gh_* 列。与调度器同样遵循「尽力而为」：任何 GitHub/D1 异常只影响本轮追踪，
// 绝不外抛、绝不影响触发循环本身。
import { decryptText } from "./crypto";
import { getWorkflowRun, listWorkflowRuns, type WorkflowRunSummary } from "./github";
import { sendNotify, type ChannelRow, type NotifyPayload } from "./notify";
import type { AccountRow, Env, JobRow } from "./types";

/** 触发后超过这么久仍没等到 workflow 完成（或连 run 都没匹配到）就放弃，
 *  gh_state 置 unknown 停止轮询。取 24h：GitHub run 排队极端情况可达数小时。 */
export const TRACK_WINDOW_MS = 24 * 3600 * 1000;

/** 匹配 run 的时间窗口下沿：dispatch created_at 与 run created_at 之间允许的
 *  时钟偏差 + GitHub 侧入队延迟。 */
const CREATED_BEFORE_MS = 2 * 60 * 1000;

/** 单轮追踪的 runs 上限：与调度器单轮 50 任务同量级，防极端积压拖长 scheduled。 */
const TRACK_LIMIT = 100;

/** GitHub 列表分页大小：窗口内匹配足够；长跑 run 掉出分页时走 getWorkflowRun 兜底 */
const LIST_PER_PAGE = 20;

type TrackRow = {
  run_id: number;
  job_id: number;
  triggered_at: number;
  gh_run_id: number | null;
  gh_state: string | null;
  repo: string;
  trigger_type: JobRow["trigger_type"];
  workflow_id: string | null;
  event_type: string | null;
  ref: string | null;
  job_name: string;
  notify: number;
  notify_channel_ids: string | null;
};

export type RunTrackResult = { matched: number; updated: number; expired: number };

/**
 * 一轮追踪：
 * 1. 查出待追踪行（成功触发的、gh_state 处于 waiting/running、未超窗口）；
 * 2. waiting 行按「时间窗口 + 分支/事件过滤」在 GitHub runs 列表里匹配 gh_run_id
 *    （同窗口多条取 created_at 最接近者，已被占用的 run id 先到先得不重复绑定）；
 * 3. running 行刷新最新状态，completed → done 并回填 conclusion；
 * 4. conclusion ≠ success 时按任务级渠道配置发 workflow_failed 告警；
 * 5. 超窗口的行置 unknown 停止追踪。
 *
 * 所有 D1/网络异常消化在本轮内，失败的部分下轮自然重试。
 */
export async function pollGhRuns(
  env: Env,
  now: number = Date.now(),
  fetchFn: typeof fetch = fetch,
  opts?: { waitUntil?: (p: Promise<unknown>) => void },
): Promise<RunTrackResult> {
  const cutoff = now - TRACK_WINDOW_MS;

  // 待追踪行：只追成功触发的（触发本身失败没有 run 可言）；waiting/running 都查，
  // waiting 匹配、running 刷新；到期未决的一并取出置 unknown。
  const due = await env.DB.prepare(
    `SELECT r.id AS run_id, r.job_id, r.triggered_at, r.gh_run_id, r.gh_state,
            j.repo, j.trigger_type, j.workflow_id, j.event_type, j.ref, j.name AS job_name,
            j.account_id, j.notify, j.notify_channel_ids
     FROM runs r JOIN jobs j ON r.job_id = j.id
     WHERE r.status='success' AND r.gh_state IN ('waiting','running')
       AND r.triggered_at > ?
     ORDER BY r.triggered_at ASC LIMIT ?`,
  )
    .bind(cutoff, TRACK_LIMIT)
    .all<TrackRow & { account_id: number }>();
  const rows = due.results ?? [];

  const expired = await env.DB.prepare(
    `SELECT id, job_id FROM runs
     WHERE status='success' AND gh_state IN ('waiting','running') AND triggered_at <= ? LIMIT ?`,
  )
    .bind(cutoff, TRACK_LIMIT)
    .all<{ id: number; job_id: number }>();
  for (const row of expired.results ?? []) {
    try {
      await env.DB.prepare("UPDATE runs SET gh_state='unknown' WHERE id=?").bind(row.id).run();
    } catch { /* 置态失败下轮重试 */ }
  }

  const result: RunTrackResult = { matched: 0, updated: 0, expired: expired.results?.length ?? 0 };
  if (rows.length === 0) return result;

  // 账号与渠道整轮读一次；PAT 解密失败（TOKEN_ENC_KEY 变更）跳过该账号本轮。
  const accounts = new Map<number, { token: string; login: string | null }>();
  for (const accountId of new Set(rows.map((r) => r.account_id))) {
    try {
      const account = await env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(accountId).first<AccountRow>();
      if (!account) continue;
      accounts.set(accountId, { token: await decryptText(account.token_encrypted, env.TOKEN_ENC_KEY), login: account.github_login });
    } catch { /* 解密失败/账号缺失：该账号本轮跳过，行保持原态下轮再试 */ }
  }
  let channels: ChannelRow[] = [];
  try {
    channels = await env.DB.prepare("SELECT * FROM notify_channels ORDER BY id").all<ChannelRow>().then((r) => r.results ?? []);
  } catch { /* 视同无渠道，只回填状态不发通知 */ }

  const notifications: Array<{ channels: ChannelRow[]; payload: NotifyPayload }> = [];

  /** 任务级渠道选择，与 scheduler.jobNotifyTargets 同语义（拷贝以保持模块解耦） */
  function jobNotifyTargets(row: TrackRow, all: ChannelRow[]): ChannelRow[] {
    if (row.notify !== 1) return [];
    if (!row.notify_channel_ids) return all;
    try {
      const ids = JSON.parse(row.notify_channel_ids) as unknown;
      if (!Array.isArray(ids) || ids.length === 0) return all;
      const set = new Set(ids.filter((x): x is number => typeof x === "number"));
      return all.filter((ch) => set.has(ch.id));
    } catch {
      return all;
    }
  }

  /** 匹配到的 run 已完成？completed 且有 conclusion 即有结论（success/failure/…） */
  function isCompleted(r: WorkflowRunSummary): boolean {
    return r.status === "completed" && r.conclusion !== null;
  }

  // repo 级去重：同 repo 多个待追踪行共享一次列表拉取（速率友好）。
  const repoListCache = new Map<string, WorkflowRunSummary[] | null>();

  // 逐行处理；行内异常消化，不影响其余行。
  for (const row of rows) {
    try {
      const account = accounts.get(row.account_id ?? 0);
      if (!account) continue;

      let current: WorkflowRunSummary | null = null;

      if (row.gh_run_id) {
        // 已绑定：直接按 id 刷新（列表分页可能已覆盖不到长跑 run）。
        const res = await getWorkflowRun(account.token, row.repo, row.gh_run_id, fetchFn);
        if (res.ok) current = res.run;
      } else {
        // 未绑定：在窗口内匹配。同 repo 共享列表结果。
        const cacheKey = `${row.repo}|${row.trigger_type}|${row.workflow_id ?? ""}`;
        let list: WorkflowRunSummary[] | null | undefined;
        if (repoListCache.has(cacheKey)) {
          list = repoListCache.get(cacheKey);
        } else {
          const res = await listWorkflowRuns(account.token, {
            repo: row.repo,
            workflowId: row.trigger_type === "workflow_dispatch" ? row.workflow_id : null,
            event: row.trigger_type === "repository_dispatch" ? "repository_dispatch" : null,
          }, fetchFn);
          list = res.ok ? res.runs : null;
          repoListCache.set(cacheKey, list);
          if (!res.ok) continue; // GitHub 侧异常：本轮跳过，下轮重试
        }
        if (!list) continue;
        current = await matchRun(row, list, env, now);
      }

      if (!current) continue; // 没匹配到：保持 waiting，下轮再试（窗口内）

      if (!row.gh_run_id) {
        result.matched++;
      }

      if (isCompleted(current)) {
        const failed = current.conclusion !== "success";
        await env.DB.prepare(
          `UPDATE runs SET gh_state='done', gh_run_id=?, gh_conclusion=?, gh_run_url=?, gh_completed_at=? WHERE id=?`,
        )
          .bind(current.run_id, current.conclusion, current.html_url, current.updated_at, row.run_id)
          .run();
        result.updated++;
        if (failed) {
          const targets = jobNotifyTargets(row, channels);
          if (targets.length > 0) {
            notifications.push({
              channels: targets,
              payload: {
                event: "workflow_failed",
                title: "Workflow 执行失败",
                body: `「${row.job_name}」触发的 workflow 执行失败（${current.conclusion}）。\n目标：${row.repo}\n详情：${current.html_url}`,
              },
            });
          }
        }
      } else {
        // 仍在排队/执行：绑定 id、推进到 running。
        if (!row.gh_run_id) {
          await env.DB.prepare(`UPDATE runs SET gh_state='running', gh_run_id=?, gh_run_url=? WHERE id=?`)
            .bind(current.run_id, current.html_url, row.run_id)
            .run();
        } else if (row.gh_state !== "running") {
          await env.DB.prepare(`UPDATE runs SET gh_state='running' WHERE id=?`).bind(row.run_id).run();
        }
      }
    } catch { /* 单行失败不影响其余行 */ }
  }

  // 告警收尾统一发送：有 waitUntil 就交给运行时收尾，否则就地等待。
  if (notifications.length > 0 && channels.length > 0) {
    const sends: Promise<boolean>[] = [];
    for (const n of notifications) {
      for (const ch of n.channels) sends.push(sendNotify(ch, n.payload, fetchFn));
    }
    const all = Promise.allSettled(sends);
    if (opts?.waitUntil) opts.waitUntil(all);
    else await all;
  }

  return result;
}

type ListRunsOk = Extract<import("./github").ListRunsResult, { ok: true }>;

/**
 * 窗口匹配：run.created_at ∈ [triggered_at − CREATED_BEFORE_MS, now]，分支一致
 * （workflow_dispatch 按 ref；repository_dispatch 无 ref 概念，仅事件过滤）。
 * 同窗口多条取 created_at 最接近 triggered_at 的；已被同 repo 其他 runs 行占用
 * 的 gh_run_id 先到先得，排除（避免两个任务共享 repo 时把同一条 run 绑给双方）。
 */
async function matchRun(
  row: TrackRow,
  list: WorkflowRunSummary[],
  env: Env,
  now: number,
): Promise<WorkflowRunSummary | null> {
  const windowStart = row.triggered_at - CREATED_BEFORE_MS;
  // 排除已占用：查同 repo 其他 runs 行已绑定的 gh_run_id。
  let taken: Set<number>;
  try {
    const takenRows = await env.DB.prepare(
      `SELECT DISTINCT r2.gh_run_id AS gid FROM runs r2
       JOIN jobs j2 ON r2.job_id = j2.id
       WHERE r2.gh_run_id IS NOT NULL AND j2.repo = ?`,
    )
      .bind(row.repo)
      .all<{ gid: number }>();
    taken = new Set((takenRows.results ?? []).map((r) => r.gid));
  } catch {
    taken = new Set(); // 查询失败时不做占用排除（宽松匹配优于放弃）
  }

  const candidates = list
    .filter((r) => r.created_at >= windowStart && r.created_at <= now)
    .filter((r) => !taken.has(r.run_id))
    .filter((r) => (row.trigger_type === "workflow_dispatch" ? row.ref : null) == null || r.head_branch === row.ref);
  if (candidates.length === 0) return null;
  // created_at 最接近 triggered_at 者
  let best = candidates[0];
  let bestDelta = Math.abs(candidates[0].created_at - row.triggered_at);
  for (const c of candidates.slice(1)) {
    const d = Math.abs(c.created_at - row.triggered_at);
    if (d < bestDelta) {
      best = c;
      bestDelta = d;
    }
  }
  return best;
}
