import { computeNextRun, validateSchedule } from "./schedule";
import { decryptText } from "./crypto";
import { triggerGithub } from "./github";
import type { AccountRow, Env, JobRow } from "./types";

const RUN_RETENTION_MS = 90 * 24 * 3600 * 1000;

export type TriggerOutcome = { ok: boolean; httpStatus: number; error?: string };

async function recordRun(env: Env, jobId: number, source: "schedule" | "manual", status: string, httpStatus: number, error: string | null) {
  await env.DB.prepare(
    "INSERT INTO runs (job_id, triggered_at, source, status, http_status, error_message) VALUES (?,?,?,?,?,?)",
  )
    .bind(jobId, Date.now(), source, status, httpStatus, error)
    .run();
}

export async function dispatchJob(env: Env, job: JobRow, account: AccountRow, source: "schedule" | "manual"): Promise<TriggerOutcome> {
  let token: string;
  try {
    token = await decryptText(account.token_encrypted, env.TOKEN_ENC_KEY);
  } catch {
    const msg = "token 解密失败（TOKEN_ENC_KEY 是否变更？）";
    await recordRun(env, job.id, source, "failed", 0, msg);
    return { ok: false, httpStatus: 0, error: msg };
  }
  const result = await triggerGithub(token, {
    repo: job.repo,
    triggerType: job.trigger_type,
    workflowId: job.workflow_id,
    eventType: job.event_type,
    ref: job.ref,
    inputsJson: job.inputs_json,
  });
  await recordRun(env, job.id, source, result.ok ? "success" : "failed", result.httpStatus, result.ok ? null : result.error);
  if (!result.ok && result.httpStatus === 401) {
    await env.DB.prepare("UPDATE accounts SET status='invalid', updated_at=? WHERE id=?")
      .bind(Date.now(), account.id)
      .run();
  }
  return { ok: result.ok, httpStatus: result.httpStatus, error: result.ok ? undefined : result.error };
}

export async function triggerJobOnce(env: Env, jobId: number, source: "schedule" | "manual"): Promise<TriggerOutcome | { notFound: true }> {
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(jobId).first<JobRow>();
  if (!job) return { notFound: true };
  const account = await env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(job.account_id).first<AccountRow>();
  if (!account) {
    await recordRun(env, job.id, source, "failed", 0, "账号不存在");
    return { ok: false, httpStatus: 0, error: "账号不存在" };
  }
  return dispatchJob(env, job, account, source);
}

export async function runDueJobs(env: Env, now: number = Date.now()): Promise<{ triggered: number; failed: number }> {
  const due = await env.DB.prepare(
    "SELECT * FROM jobs WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at ASC LIMIT 50",
  )
    .bind(now)
    .all<JobRow>();

  let triggered = 0;
  let failed = 0;
  for (const job of due.results ?? []) {
    // 逐任务 try/catch：单个任务抛异常（schedule_json 损坏、cron 无可达触发时间、
    // 瞬时 D1 错误等）只计为 failed，不影响其余任务触发与后续 90 天清理，
    // 防止单任务异常导致整个调度循环中止、scheduled handler reject。
    try {
      const v = validateSchedule(JSON.parse(job.schedule_json));
      if (!v.ok) continue; // 调度规则损坏：跳过（不发触发，也不推进时间）
      // 基于原计划时间累加，避免累积漂移
      const newNext = computeNextRun(v.rule, job.next_run_at);
      const claim = await env.DB.prepare(
        "UPDATE jobs SET next_run_at=?, updated_at=? WHERE id=? AND next_run_at=? AND enabled=1",
      )
        .bind(newNext, now, job.id, job.next_run_at)
        .run();
      if ((claim.meta.changes ?? 0) !== 1) continue; // 已被并发执行实例处理

      const account = await env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(job.account_id).first<AccountRow>();
      if (!account) {
        await recordRun(env, job.id, "schedule", "failed", 0, "账号不存在");
        failed++;
        continue;
      }
      const result = await dispatchJob(env, job, account, "schedule");
      if (result.ok) triggered++;
      else failed++;
      await env.DB.prepare("UPDATE jobs SET last_run_at=? WHERE id=?").bind(now, job.id).run();
    } catch (e) {
      failed++;
      const msg = `调度器内部错误: ${(e as Error).message}`.slice(0, 500);
      try {
        await recordRun(env, job.id, "schedule", "failed", 0, msg);
      } catch { /* 记录失败本身失败时忽略，不影响隔离 */ }
      // 抛错发生在乐观锁 claim 之前时 next_run_at 未推进，任务会每周期重复
      // "到期→重抛"，形成热循环。这里用 now+30min 兜底推进（复用乐观锁，
      // 若已推进过则不匹配、无副作用），让损坏任务降温到每 30 分钟重试一次，
      // 而不是每 5 分钟瘫痪式重抛。
      try {
        await env.DB.prepare(
          "UPDATE jobs SET next_run_at=?, updated_at=? WHERE id=? AND next_run_at=? AND enabled=1",
        )
          .bind(now + 30 * 60_000, now, job.id, job.next_run_at)
          .run();
      } catch { /* 兜底推进失败时忽略，下周期会再次尝试 */ }
    }
  }

  await env.DB.prepare("DELETE FROM runs WHERE triggered_at < ?").bind(now - RUN_RETENTION_MS).run();
  return { triggered, failed };
}
