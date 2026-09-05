import { computeNextRun, validateSchedule } from "./schedule";
import { decryptText } from "./crypto";
import { triggerGithub } from "./github";
import { sendNotify, getChannels, type ChannelRow, type NotifyPayload } from "./notify";
import { DEFAULT_RUN_RETENTION_DAYS, KEY_RUNS_RETENTION, KEY_SCHEDULER_HEARTBEAT, getAutoPauseThreshold, getSetting, setSetting } from "./settings";
import type { AccountRow, Env, JobRow } from "./types";

export type TriggerOutcome = { ok: boolean; httpStatus: number; error?: string };

/** 单轮调度的派发并发度：见 runDueJobs 内注释 */
const SCHEDULE_CONCURRENCY = 8;

/** scheduled 入口的等待钩子（ExecutionContext 的结构子集），便于测试注入 */
export type WaitUntilHost = { waitUntil(promise: Promise<unknown>): void };

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

/** 任务级渠道选择：notify=0 关闭；channel_ids 为 JSON 数组多选；NULL/空/损坏 = 全部渠道 */
function jobNotifyTargets(job: JobRow, channels: ChannelRow[]): ChannelRow[] {
  if (job.notify !== 1) return [];
  if (!job.notify_channel_ids) return channels;
  try {
    const ids = JSON.parse(job.notify_channel_ids) as unknown;
    if (!Array.isArray(ids) || ids.length === 0) return channels;
    const set = new Set(ids.filter((x): x is number => typeof x === "number"));
    return channels.filter((ch) => set.has(ch.id)); // 所选渠道全被删时为空 → 不发送
  } catch {
    return channels; // JSON 损坏按全部兜底
  }
}

export async function runDueJobs(env: Env, now: number = Date.now(), ctx?: WaitUntilHost): Promise<{ triggered: number; failed: number }> {
  // 心跳：写在本轮扫描之前——即使中途被杀也已落库，仪表盘据此展示调度器
  // 是否存活。写失败不影响本轮调度，下轮再写。
  try {
    await setSetting(env, KEY_SCHEDULER_HEARTBEAT, String(now));
  } catch { /* 心跳失败可忽略 */ }

  // 告警配置整轮读一次：渠道未配置时，计数与自动停用照常进行，只是不发消息。
  // D1 瞬时错误视同无渠道，不阻断调度。
  let channels: ChannelRow[] = [];
  try {
    channels = await getChannels(env);
  } catch { /* 视同无渠道 */ }
  const threshold = await getAutoPauseThreshold(env);
  const notifications: Array<{ channels: ChannelRow[]; payload: NotifyPayload }> = [];
  // PAT 失效按账号去重：同一失效账号的多个任务在同轮失败只推一条
  const invalidNotified = new Set<number>();

  const due = await env.DB.prepare(
    "SELECT * FROM jobs WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at ASC LIMIT 50",
  )
    .bind(now)
    .all<JobRow>();
  const rows = due.results ?? [];

  let triggered = 0;
  let failed = 0;

  /** 处理单个到期任务。所有异常都在这里消化，绝不外抛。 */
  async function processJob(job: JobRow): Promise<void> {
    // 逐任务 try/catch：单个任务抛异常（schedule_json 损坏、cron 无可达触发时间、
    // 瞬时 D1 错误等）只计为 failed，不影响其余任务触发与后续 90 天清理，
    // 防止单任务异常导致整个调度循环中止、scheduled handler reject。
    try {
      const v = validateSchedule(JSON.parse(job.schedule_json));
      if (!v.ok) return; // 调度规则损坏：跳过（不发触发，也不推进时间）
      // 基于原计划时间累加，避免累积漂移；若算出的时间仍在过去（停机/漏跑积压），
      // 从 now 重算快进：本轮立即补发这一次，之后恢复正常节奏，而不是每 5 分钟
      // 一轮逐个补发积压的每一次（补偿式连发）。
      let newNext = computeNextRun(v.rule, job.next_run_at, Math.random, job.timezone ?? undefined);
      if (newNext <= now) newNext = computeNextRun(v.rule, now, Math.random, job.timezone ?? undefined);
      const claim = await env.DB.prepare(
        "UPDATE jobs SET next_run_at=?, updated_at=? WHERE id=? AND next_run_at=? AND enabled=1",
      )
        .bind(newNext, now, job.id, job.next_run_at)
        .run();
      if ((claim.meta.changes ?? 0) !== 1) return; // 已被并发执行实例处理

      const account = await env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(job.account_id).first<AccountRow>();
      if (!account) {
        await recordRun(env, job.id, "schedule", "failed", 0, "账号不存在");
        failed++;
        return;
      }
      const result = await dispatchJob(env, job, account, "schedule");
      if (result.ok) {
        triggered++;
        // 成功即清零连续失败计数（非零才写，避免每轮多余写入）
        if ((job.fail_streak ?? 0) !== 0) {
          await env.DB.prepare("UPDATE jobs SET fail_streak=? WHERE id=?").bind(0, job.id).run();
        }
      } else {
        failed++;
        // 连续失败计数与自动停用只看定时调度：手动触发意味着管理员在场，失败
        // 当场可见（toast + 运行记录），不计入无人值守的保护机制。
        const streak = (job.fail_streak ?? 0) + 1;
        await env.DB.prepare("UPDATE jobs SET fail_streak=? WHERE id=?").bind(streak, job.id).run();
        let paused = false;
        if (threshold > 0 && streak >= threshold) {
          const pause = await env.DB.prepare(
            "UPDATE jobs SET enabled=0, updated_at=? WHERE id=? AND enabled=1",
          )
            .bind(now, job.id)
            .run();
          paused = (pause.meta.changes ?? 0) === 1;
        }
        // 任务级渠道多选：关闭 / 指定若干渠道 / NULL = 全部渠道
        const jobChannels = jobNotifyTargets(job, channels);
        if (jobChannels.length > 0) {
          notifications.push({
            channels: jobChannels,
            payload: paused
              ? {
                  event: "job_auto_paused",
                  title: "任务已自动停用",
                  body: `「${job.name}」连续失败 ${streak} 次，已自动停用。\n目标：${job.repo}\n最近错误：${result.error ?? "-"}`,
                }
              : {
                  event: "job_failed",
                  title: "任务触发失败",
                  body: `「${job.name}」触发失败（连续第 ${streak} 次）。\n目标：${job.repo}\n错误：${result.error ?? "-"}`,
                },
          });
        }
        if (result.httpStatus === 401 && channels.length > 0 && !invalidNotified.has(account.id)) {
          invalidNotified.add(account.id);
          notifications.push({
            channels,
            payload: {
              event: "account_invalid",
              title: "GitHub 账号 PAT 已失效",
              body: `账号「${account.name}」的 PAT 触发 401，已被标记失效，其任务将无法触发，请到「账号」页更新。`,
            },
          });
        }
      }
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

  // 有界并发派发：单任务最坏 15s 超时 ×2 + 1s 重试间隔 ≈ 31s，串行 50 个可拖满
  // cron 触发 15 分钟的墙钟上限——排在后面的任务被杀，且已认领（next_run_at 已
  // 推进）未派发的会被静默丢跑。并发 8 把最坏情况压到约 4 分钟；认领是乐观锁，
  // worker 之间、并发实例之间都不会重复触发。
  let next = 0;
  async function worker(): Promise<void> {
    while (next < rows.length) {
      const job = rows[next++];
      await processJob(job);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SCHEDULE_CONCURRENCY, rows.length) }, () => worker()),
  );

  // 告警统一在派发收尾后发送，不阻塞触发本身：scheduled 路径挂 waitUntil 交给
  // 运行时收尾，无 ctx 的调用方（测试/手动路径）就地等待。allSettled 保证单条
  // 发送失败不影响其余；sendNotify 内部已吞掉网络异常。
  if (notifications.length > 0 && channels.length > 0) {
    const sends: Promise<boolean>[] = [];
    for (const n of notifications) {
      for (const ch of n.channels) sends.push(sendNotify(ch, n.payload));
    }
    const all = Promise.allSettled(sends);
    if (ctx) ctx.waitUntil(all);
    else await all;
  }

  // 自动清理：保留期可在界面配置（settings.runs_retention_days），缺省 90 天。
  // 清理失败不影响本轮触发结果，下个周期会再试。
  try {
    const configured = Number(await getSetting(env, KEY_RUNS_RETENTION));
    const retentionDays = Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_RUN_RETENTION_DAYS;
    await env.DB.prepare("DELETE FROM runs WHERE triggered_at < ?")
      .bind(now - retentionDays * 24 * 3600 * 1000)
      .run();
  } catch { /* 清理失败时忽略，5 分钟后重试 */ }
  return { triggered, failed };
}
