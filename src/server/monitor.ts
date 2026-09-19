// HTTP 心跳监控：周期性探测外部地址（默认浏览器 UA + 可自定义请求头，模拟真实
// 访问），状态变化推送通知并可联动触发任务（宕机自动恢复场景）。探测是尽力而为：
// 单个监控的任何异常只影响自己，绝不拖垮其余监控与调度循环。
import { notifyLinkJobFailed, notifyMonitorDown, notifyMonitorUp, getChannels, sendNotify, type ChannelRow, type NotifyPayload } from "./notify";
import { triggerJobOnce, type WaitUntilHost } from "./scheduler";
import {
  DEFAULT_HEARTBEAT_RETENTION_DAYS,
  KEY_HEARTBEATS_RETENTION,
  getSetting,
} from "./settings";
import type { Env, MonitorRow } from "./types";

/** 单轮探测并发度：单探测最坏 30s 超时，并发 5 压住 cron 触发的墙钟窗口。 */
const PROBE_CONCURRENCY = 5;
/** 每轮探测上限：探测与任务派发/GitHub 追踪/通知共享免费版单次调用 50 subrequest 预算。 */
const PROBES_PER_WAKE = 20;
/** 关键词检查最多读取的响应体字节数：只需"包含"判定，读完超大响应纯属浪费。 */
const KEYWORD_MAX_BYTES = 1024 * 1024;

/** 模拟真实浏览器访问的默认请求头；headers_json 里的同名头覆盖这里 */
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

export type ProbeResult = {
  status: "up" | "down";
  http_status: number | null;
  latency_ms: number;
  error: string | null;
};

/** 读取响应体前 maxBytes 字节后中断连接（关键词只需子串判定，无需读完整个响应）。 */
async function readBodyPrefix(res: Response, maxBytes = KEYWORD_MAX_BYTES): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let bytes = 0;
  let text = "";
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } catch { /* 读一半断了通常也够判定 */ } finally {
    try { await reader.cancel(); } catch { /* 流可能已自然结束 */ }
  }
  return text;
}

/** 及时释放不再需要的响应体，避免连接挂着等 GC。 */
async function drainBody(res: Response): Promise<void> {
  try { await res.body?.cancel(); } catch { /* 已结束的流 cancel 会报错，忽略 */ }
}

export async function probeMonitor(monitor: MonitorRow, fetchFn: typeof fetch = fetch): Promise<ProbeResult> {
  const started = performance.now();
  const headers: Record<string, string> = { ...DEFAULT_HEADERS };
  if (monitor.headers_json) {
    try {
      const parsed = JSON.parse(monitor.headers_json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") headers[k] = v;
        }
      }
    } catch { /* headers_json 损坏按默认头兜底，创建时已校验过 */ }
  }

  let res: Response;
  try {
    res = await fetchFn(monitor.url, {
      method: monitor.method,
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(monitor.timeout_ms),
    });
  } catch (e) {
    const err = e as Error;
    // Workers 上超时抛 TimeoutError；部分运行时以 AbortError 表现，一并识别
    const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
    return {
      status: "down",
      http_status: null,
      latency_ms: Math.round(performance.now() - started),
      error: timedOut
        ? `探测超时（${Math.round(monitor.timeout_ms / 1000)}s 无响应）`
        : `网络错误：${err.message}`.slice(0, 500),
    };
  }
  const latency = Math.round(performance.now() - started);
  const expectedOk = monitor.expected_status === 0
    ? res.status >= 200 && res.status < 300
    : res.status === monitor.expected_status;
  if (!expectedOk) {
    await drainBody(res);
    return {
      status: "down",
      http_status: res.status,
      latency_ms: latency,
      error: monitor.expected_status === 0
        ? `状态码 ${res.status}（期望 2xx）`
        : `状态码 ${res.status}（期望 ${monitor.expected_status}）`,
    };
  }
  // 关键词检查只在 GET 上进行（HEAD 无响应体）
  if (monitor.keyword && monitor.method === "GET") {
    const body = await readBodyPrefix(res);
    if (!body.includes(monitor.keyword)) {
      return {
        status: "down",
        http_status: res.status,
        latency_ms: latency,
        error: `响应体未包含关键词「${monitor.keyword}」`,
      };
    }
  } else {
    await drainBody(res);
  }
  return { status: "up", http_status: res.status, latency_ms: latency, error: null };
}

export type ProbeOutcome = {
  result: ProbeResult;
  /** 发生 down 转换（达到阈值且原状态非 down）：仅调度路径会出现 */
  downTransition: boolean;
  /** 发生 up 恢复转换（原状态为 down 且本次成功） */
  upTransition: boolean;
  /** 落库后的连续失败计数 */
  failStreak: number;
  /** 联动任务名（成功触发时，通知文案用） */
  linkJobName: string | null;
  /** 联动触发失败的错误描述 */
  linkError: string | null;
};

/**
 * 探测一次并落库：写 heartbeats、按状态机更新 monitors、状态转换时触发联动任务。
 * source=schedule 计入 fail_streak 并参与 down 判定；manual 只记录与恢复，不累计失败
 * （管理员在场，对齐任务手动触发不计入无人值守保护的语义）。
 */
export async function probeAndRecord(
  env: Env,
  monitor: MonitorRow,
  now: number,
  source: "schedule" | "manual",
  fetchFn: typeof fetch = fetch,
): Promise<ProbeOutcome> {
  const result = await probeMonitor(monitor, fetchFn);
  await env.DB.prepare(
    "INSERT INTO heartbeats (monitor_id, created_at, status, http_status, latency_ms, error_message) VALUES (?,?,?,?,?,?)",
  )
    .bind(monitor.id, now, result.status, result.http_status, result.latency_ms, result.error)
    .run();

  const prevStatus = monitor.status;
  let failStreak = monitor.fail_streak ?? 0;
  let status = prevStatus;
  let downTransition = false;
  let upTransition = false;
  if (result.status === "up") {
    failStreak = 0;
    upTransition = prevStatus === "down";
    status = "up";
  } else if (source === "schedule") {
    failStreak += 1;
    if (prevStatus !== "down" && failStreak >= (monitor.fail_threshold || 1)) {
      downTransition = true;
      status = "down";
    }
  }
  await env.DB.prepare(
    "UPDATE monitors SET status=?, fail_streak=?, last_latency_ms=?, last_run_at=?, updated_at=? WHERE id=?",
  )
    .bind(status, failStreak, result.latency_ms, now, now, monitor.id)
    .run();

  // 状态转换时的任务联动：down 触发恢复脚本 / up 触发善后脚本。联动任务往往就是
  // 停用定时调度、只留给联动用的，因此不受任务 enabled 状态限制。
  let linkJobName: string | null = null;
  let linkError: string | null = null;
  const linkJobId = downTransition
    ? monitor.on_down_job_id
    : upTransition
      ? monitor.on_up_job_id
      : null;
  if (linkJobId) {
    const job = await env.DB.prepare("SELECT id, name FROM jobs WHERE id=?")
      .bind(linkJobId)
      .first<{ id: number; name: string }>();
    if (!job) {
      linkError = "联动任务不存在（可能已被删除）";
    } else {
      const r = await triggerJobOnce(env, linkJobId, "monitor");
      if ("notFound" in r) linkError = "联动任务不存在";
      else if (!r.ok) linkError = r.error ?? "触发失败";
      else linkJobName = job.name;
    }
  }
  return { result, downTransition, upTransition, failStreak, linkJobName, linkError };
}

/** 监控级渠道选择：notify=0 关闭；channel_ids 为 JSON 数组多选；NULL/空/损坏 = 全部渠道 */
function monitorNotifyTargets(monitor: MonitorRow, channels: ChannelRow[]): ChannelRow[] {
  if (monitor.notify !== 1) return [];
  if (!monitor.notify_channel_ids) return channels;
  try {
    const ids = JSON.parse(monitor.notify_channel_ids) as unknown;
    if (!Array.isArray(ids) || ids.length === 0) return channels;
    const set = new Set(ids.filter((x): x is number => typeof x === "number"));
    return channels.filter((ch) => set.has(ch.id)); // 所选渠道全被删时为空 → 不发送
  } catch {
    return channels; // JSON 损坏按全部兜底
  }
}

export async function runDueMonitors(
  env: Env,
  now: number = Date.now(),
  ctx?: WaitUntilHost,
): Promise<{ probed: number; down: number }> {
  const due = await env.DB.prepare(
    "SELECT * FROM monitors WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at ASC LIMIT ?",
  )
    .bind(now, PROBES_PER_WAKE)
    .all<MonitorRow>();
  const rows = due.results ?? [];

  // 渠道读失败视同无渠道：照常探测，只是不发通知（同任务调度的取舍）
  let channels: ChannelRow[] = [];
  try {
    channels = await getChannels(env);
  } catch { /* 视同无渠道 */ }
  const notifications: Array<{ channels: ChannelRow[]; payload: NotifyPayload }> = [];

  let probed = 0;
  let down = 0;

  async function processMonitor(monitor: MonitorRow): Promise<void> {
    try {
      // 乐观锁认领：先推进 next_run_at 再探测，多 isolate 并发时只有一个实例执行
      const claim = await env.DB.prepare(
        "UPDATE monitors SET next_run_at=?, updated_at=? WHERE id=? AND next_run_at=? AND enabled=1",
      )
        .bind(now + monitor.interval_seconds * 1000, now, monitor.id, monitor.next_run_at)
        .run();
      if ((claim.meta.changes ?? 0) !== 1) return;

      const outcome = await probeAndRecord(env, monitor, now, "schedule", fetch);
      probed++;
      if (outcome.result.status === "down") down++;
      const mChannels = monitorNotifyTargets(monitor, channels);
      if (outcome.downTransition) {
        if (mChannels.length > 0) {
          notifications.push({
            channels: mChannels,
            payload: notifyMonitorDown({
              name: monitor.name,
              error: outcome.result.error,
              linkJobName: outcome.linkJobName,
            }),
          });
          // 联动触发失败也是无人值守事故，走同一组渠道告警（notify 关闭时静默）
          if (outcome.linkError) {
            notifications.push({
              channels: mChannels,
              payload: notifyLinkJobFailed({
                name: monitor.name,
                error: outcome.linkError,
              }),
            });
          }
        }
      }
      if (outcome.upTransition && mChannels.length > 0) {
        notifications.push({
          channels: mChannels,
          payload: notifyMonitorUp({
            name: monitor.name,
            httpStatus: outcome.result.http_status,
            latencyMs: outcome.result.latency_ms,
            linkJobName: outcome.linkJobName,
          }),
        });
      }
    } catch (e) {
      down++;
      // 落库/联动阶段抛错时本轮结果丢失，写一条降级心跳保底可查；
      // next_run_at 已在认领时推进，不会热循环。
      try {
        await env.DB.prepare(
          "INSERT INTO heartbeats (monitor_id, created_at, status, http_status, latency_ms, error_message) VALUES (?,?,?,?,?,?)",
        )
          .bind(monitor.id, now, "down", null, null, `调度器内部错误: ${(e as Error).message}`.slice(0, 500))
          .run();
      } catch { /* 保底也失败就等下轮 */ }
    }
  }

  // 有界并发：探测超时上限 30s（timeout_ms 校验上界），并发 5 保证最坏情况下
  // 20 个监控也不会拖满 cron 触发的墙钟窗口。
  let next = 0;
  async function worker(): Promise<void> {
    while (next < rows.length) {
      const monitor = rows[next++];
      await processMonitor(monitor);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, rows.length) }, () => worker()),
  );

  // 通知在探测收尾后统一发送（有 ctx 挂 waitUntil，无 ctx 就地等待）；
  // allSettled 保证单条失败不影响其余。
  const tail = (async () => {
    if (notifications.length > 0 && channels.length > 0) {
      const sends: Promise<boolean>[] = [];
      for (const n of notifications) {
        for (const ch of n.channels) sends.push(sendNotify(ch, n.payload));
      }
      await Promise.allSettled(sends);
    }
  })();
  if (ctx) ctx.waitUntil(tail);
  else await tail;

  // 心跳保留期清理：每监控每天最多 720 条（2 分钟粒度），默认 30 天。清理失败
  // 不影响本轮探测结果，下个周期会再试。
  try {
    const configured = Number(await getSetting(env, KEY_HEARTBEATS_RETENTION));
    const retentionDays = Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_HEARTBEAT_RETENTION_DAYS;
    await env.DB.prepare("DELETE FROM heartbeats WHERE created_at < ?")
      .bind(now - retentionDays * 24 * 3600 * 1000)
      .run();
  } catch { /* 清理失败时忽略，下轮重试 */ }

  return { probed, down };
}
