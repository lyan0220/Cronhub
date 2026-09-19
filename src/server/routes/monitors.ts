import { Hono } from "hono";
import { probeAndRecord } from "../monitor";
import { assertChannelsExist } from "./jobs";
import type { Env, MonitorRow } from "../types";

const monitorRoutes = new Hono<{ Bindings: Env }>();

const DAY = 24 * 3600 * 1000;

type MonitorInput = {
  name: string;
  url: string;
  method: "GET" | "HEAD";
  expected_status: number;
  keyword: string | null;
  headers_json: string | null;
  timeout_ms: number;
  interval_seconds: number;
  enabled: number;
  notify: number;
  notify_channel_ids: string | null;
  fail_threshold: number;
  on_down_job_id: number | null;
  on_up_job_id: number | null;
};

function validateMonitorBody(body: Record<string, unknown>): { ok: true; data: MonitorInput } | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return { ok: false, error: "监控名必填（≤100 字）" };

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2048) return { ok: false, error: "URL 必填（≤2048 字符）" };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "URL 必须是 http/https 地址" };
    }
  } catch {
    return { ok: false, error: "URL 格式无效" };
  }

  const method = body.method === "HEAD" ? "HEAD" : "GET";

  // 0 = 任意 2xx 即成功；其余精确匹配
  const expected_status = body.expected_status === undefined || body.expected_status === null || body.expected_status === ""
    ? 0
    : Number(body.expected_status);
  if (!Number.isInteger(expected_status) || (expected_status !== 0 && (expected_status < 100 || expected_status > 599))) {
    return { ok: false, error: "期望状态码应为 0（任意 2xx）或 100-599 的整数" };
  }

  let keyword: string | null = null;
  if (typeof body.keyword === "string" && body.keyword.trim()) {
    keyword = body.keyword.trim();
    if (keyword.length > 200) return { ok: false, error: "关键词长度不能超过 200 字符" };
  }

  let headers_json: string | null = null;
  if (typeof body.headers_json === "string" && body.headers_json.trim()) {
    try {
      const v = JSON.parse(body.headers_json) as unknown;
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
      if (!Object.values(v).every((x) => typeof x === "string")) throw new Error();
      headers_json = JSON.stringify(v);
    } catch {
      return { ok: false, error: "自定义请求头必须是「字符串值的 JSON 对象」，如 {\"X-Token\": \"abc\"}" };
    }
  }

  const timeout_ms = body.timeout_ms === undefined || body.timeout_ms === null || body.timeout_ms === ""
    ? 10000
    : Number(body.timeout_ms);
  if (!Number.isInteger(timeout_ms) || timeout_ms < 1000 || timeout_ms > 30000) {
    return { ok: false, error: "超时时间应为 1-30 秒" };
  }

  const interval_seconds = body.interval_seconds === undefined || body.interval_seconds === null || body.interval_seconds === ""
    ? 300
    : Number(body.interval_seconds);
  if (!Number.isInteger(interval_seconds) || interval_seconds < 120 || interval_seconds > 86400) {
    return { ok: false, error: "检测间隔应为 2-1440 分钟（平台每 2 分钟唤醒一次）" };
  }

  const fail_threshold = body.fail_threshold === undefined || body.fail_threshold === null || body.fail_threshold === ""
    ? 1
    : Number(body.fail_threshold);
  if (!Number.isInteger(fail_threshold) || fail_threshold < 1 || fail_threshold > 10) {
    return { ok: false, error: "失败阈值应为 1-10 的整数" };
  }

  const enabled = body.enabled === 0 || body.enabled === false ? 0 : 1;
  const notify = body.notify === 1 || body.notify === true ? 1 : 0;
  let notify_channel_ids: string | null = null;
  if (Array.isArray(body.notify_channel_ids)) {
    const ids = [...new Set(body.notify_channel_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    notify_channel_ids = ids.length ? JSON.stringify(ids) : null;
  }

  // 联动任务：可空；非空时必须是正整数（存在性在路由里查库校验）
  const parseJobId = (v: unknown): number | null => {
    if (v === undefined || v === null || v === "" || v === 0) return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : -1; // -1 = 非法
  };
  const on_down_job_id = parseJobId(body.on_down_job_id);
  const on_up_job_id = parseJobId(body.on_up_job_id);
  if (on_down_job_id === -1 || on_up_job_id === -1) {
    return { ok: false, error: "联动任务选择无效" };
  }

  return {
    ok: true,
    data: { name, url, method, expected_status, keyword, headers_json, timeout_ms, interval_seconds, enabled, notify, notify_channel_ids, fail_threshold, on_down_job_id, on_up_job_id },
  };
}

/** 校验联动任务都存在（任务可能被并发删除） */
async function assertLinkJobsExist(env: Env, ids: Array<number | null>): Promise<string | null> {
  const real = ids.filter((x): x is number => typeof x === "number");
  if (real.length === 0) return null;
  const rows = await env.DB.prepare("SELECT id FROM jobs").all<{ id: number }>();
  const known = new Set((rows.results ?? []).map((r) => r.id));
  const missing = [...new Set(real)].filter((id) => !known.has(id));
  return missing.length ? `联动任务不存在（id: ${missing.join(", ")}），请重新选择` : null;
}

monitorRoutes.get("/", async (c) => {
  const now = Date.now();
  const rows = await c.env.DB.prepare(
    `SELECT m.*,
       jd.name AS on_down_job_name,
       ju.name AS on_up_job_name,
       (SELECT status FROM heartbeats h WHERE h.monitor_id=m.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_status,
       (SELECT created_at FROM heartbeats h WHERE h.monitor_id=m.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_heartbeat_at,
       (SELECT COUNT(*) FROM heartbeats h WHERE h.monitor_id=m.id AND h.created_at>=?) AS hb_24h_total,
       (SELECT COUNT(*) FROM heartbeats h WHERE h.monitor_id=m.id AND h.created_at>=? AND h.status='up') AS hb_24h_up,
       (SELECT COUNT(*) FROM heartbeats h WHERE h.monitor_id=m.id AND h.created_at>=?) AS hb_7d_total,
       (SELECT COUNT(*) FROM heartbeats h WHERE h.monitor_id=m.id AND h.created_at>=? AND h.status='up') AS hb_7d_up,
       (SELECT CAST(AVG(h.latency_ms) AS INTEGER) FROM heartbeats h WHERE h.monitor_id=m.id AND h.created_at>=? AND h.status='up') AS avg_latency_24h
     FROM monitors m
     LEFT JOIN jobs jd ON m.on_down_job_id=jd.id
     LEFT JOIN jobs ju ON m.on_up_job_id=ju.id
     ORDER BY m.id DESC`,
  )
    .bind(now - DAY, now - DAY, now - 7 * DAY, now - 7 * DAY, now - DAY)
    .all();
  const list = (rows.results ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const total24 = (row.hb_24h_total as number) ?? 0;
    const up24 = (row.hb_24h_up as number) ?? 0;
    const total7d = (row.hb_7d_total as number) ?? 0;
    const up7d = (row.hb_7d_up as number) ?? 0;
    return {
      ...row,
      // 无数据时为 null（前端隐藏，避免 0% 误读为「全部宕机」）
      uptime_24h: total24 > 0 ? Math.round((up24 / total24) * 100) : null,
      uptime_7d: total7d > 0 ? Math.round((up7d / total7d) * 100) : null,
    };
  });
  return c.json({ ok: true, data: list });
});

// 各监控最近 N 次心跳（列表卡片条带用）。监控数量少，逐监控走 (monitor_id,
// created_at DESC) 索引的小查询，比全表窗口函数扫描划算；返回旧→新排序。
monitorRoutes.get("/beats", async (c) => {
  const per = Math.min(100, Math.max(10, Number(c.req.query("per") ?? 40) || 40));
  const ids = await c.env.DB.prepare("SELECT id FROM monitors").all<{ id: number }>();
  const out: Record<number, unknown[]> = {};
  await Promise.all((ids.results ?? []).map(async (m) => {
    const rows = await c.env.DB.prepare(
      "SELECT id, created_at, status, http_status, latency_ms, error_message FROM heartbeats WHERE monitor_id=? ORDER BY created_at DESC, id DESC LIMIT ?",
    )
      .bind(m.id, per)
      .all();
    out[m.id] = (rows.results ?? []).reverse();
  }));
  return c.json({ ok: true, data: out });
});

monitorRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as never);
  const v = validateMonitorBody(body);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  const jobErr = await assertLinkJobsExist(c.env, [v.data.on_down_job_id, v.data.on_up_job_id]);
  if (jobErr) return c.json({ ok: false, error: jobErr }, 400);
  const chErr = await assertChannelsExist(c.env, v.data.notify_channel_ids);
  if (chErr) return c.json({ ok: false, error: chErr }, 400);

  const now = Date.now();
  const r = await c.env.DB.prepare(
    `INSERT INTO monitors (name, url, method, expected_status, keyword, headers_json, timeout_ms, interval_seconds,
       enabled, notify, notify_channel_ids, fail_threshold, on_down_job_id, on_up_job_id, status, fail_streak, next_run_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', 0, ?, ?, ?)`,
  )
    .bind(v.data.name, v.data.url, v.data.method, v.data.expected_status, v.data.keyword, v.data.headers_json,
      v.data.timeout_ms, v.data.interval_seconds, v.data.enabled, v.data.notify, v.data.notify_channel_ids,
      v.data.fail_threshold, v.data.on_down_job_id, v.data.on_up_job_id, now, now, now)
    .run();
  const monitor = await c.env.DB.prepare("SELECT * FROM monitors WHERE id=?").bind(r.meta.last_row_id).first<MonitorRow>();
  return c.json({ ok: true, data: monitor }, 201);
});

monitorRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const monitor = await c.env.DB.prepare("SELECT * FROM monitors WHERE id=?").bind(id).first<MonitorRow>();
  if (!monitor) return c.json({ ok: false, error: "监控不存在" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as never);
  const v = validateMonitorBody(body);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  const jobErr = await assertLinkJobsExist(c.env, [v.data.on_down_job_id, v.data.on_up_job_id]);
  if (jobErr) return c.json({ ok: false, error: jobErr }, 400);
  const chErr = await assertChannelsExist(c.env, v.data.notify_channel_ids);
  if (chErr) return c.json({ ok: false, error: chErr }, 400);

  const now = Date.now();
  // 换了探测目标：旧目标的 up/down 结论不再有意义，重置状态机并把历史状态从
  // down 直接归位 pending，避免下一次探测成功时对新目标误触发一次恢复联动。
  const targetChanged = monitor.url !== v.data.url || monitor.method !== v.data.method;
  const status = targetChanged ? "pending" : monitor.status;
  const failStreak = targetChanged ? 0 : monitor.fail_streak;
  await c.env.DB.prepare(
    `UPDATE monitors SET name=?, url=?, method=?, expected_status=?, keyword=?, headers_json=?, timeout_ms=?,
       interval_seconds=?, enabled=?, notify=?, notify_channel_ids=?, fail_threshold=?, on_down_job_id=?, on_up_job_id=?,
       status=?, fail_streak=?, next_run_at=?, updated_at=? WHERE id=?`,
  )
    .bind(v.data.name, v.data.url, v.data.method, v.data.expected_status, v.data.keyword, v.data.headers_json,
      v.data.timeout_ms, v.data.interval_seconds, v.data.enabled, v.data.notify, v.data.notify_channel_ids,
      v.data.fail_threshold, v.data.on_down_job_id, v.data.on_up_job_id, status, failStreak, now, now, id)
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM monitors WHERE id=?").bind(id).first<MonitorRow>();
  return c.json({ ok: true, data: updated });
});

monitorRoutes.post("/:id/toggle", async (c) => {
  const id = Number(c.req.param("id"));
  const monitor = await c.env.DB.prepare("SELECT * FROM monitors WHERE id=?").bind(id).first<MonitorRow>();
  if (!monitor) return c.json({ ok: false, error: "监控不存在" }, 404);
  const newEnabled = monitor.enabled === 1 ? 0 : 1;
  // 手动启停顺带清零 fail_streak 并立即排程：与任务启停同语义，避免旧计数
  // 影响重新启用后的 down 判定。
  await c.env.DB.prepare("UPDATE monitors SET enabled=?, next_run_at=?, updated_at=?, fail_streak=0 WHERE id=?")
    .bind(newEnabled, Date.now(), Date.now(), id)
    .run();
  return c.json({ ok: true, data: { enabled: newEnabled } });
});

monitorRoutes.post("/:id/probe", async (c) => {
  const id = Number(c.req.param("id"));
  const monitor = await c.env.DB.prepare("SELECT * FROM monitors WHERE id=?").bind(id).first<MonitorRow>();
  if (!monitor) return c.json({ ok: false, error: "监控不存在" }, 404);
  // 手动探测：记录心跳、成功可立即恢复 up（联动照常），但不累计失败、不判 down
  const outcome = await probeAndRecord(c.env, monitor, Date.now(), "manual");
  return c.json({ ok: true, data: outcome });
});

monitorRoutes.get("/:id/heartbeats", async (c) => {
  const id = Number(c.req.param("id"));
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
  const before = Number(c.req.query("before") ?? 0) || 0;
  const rows = await c.env.DB.prepare(
    "SELECT * FROM heartbeats WHERE monitor_id=? AND (? = 0 OR id < ?) ORDER BY id DESC LIMIT ?",
  )
    .bind(id, before, before, limit)
    .all();
  return c.json({ ok: true, data: rows.results ?? [] });
});

monitorRoutes.get("/:id/stats", async (c) => {
  const id = Number(c.req.param("id"));
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM heartbeats WHERE monitor_id=? AND created_at>=?) AS t24,
       (SELECT COUNT(*) FROM heartbeats WHERE monitor_id=? AND created_at>=? AND status='up') AS u24,
       (SELECT COUNT(*) FROM heartbeats WHERE monitor_id=? AND created_at>=?) AS t7,
       (SELECT COUNT(*) FROM heartbeats WHERE monitor_id=? AND created_at>=? AND status='up') AS u7,
       (SELECT COUNT(*) FROM heartbeats WHERE monitor_id=? AND created_at>=?) AS t30,
       (SELECT COUNT(*) FROM heartbeats WHERE monitor_id=? AND created_at>=? AND status='up') AS u30,
       (SELECT CAST(AVG(latency_ms) AS INTEGER) FROM heartbeats WHERE monitor_id=? AND created_at>=? AND status='up') AS avg_latency_24h,
       (SELECT MAX(latency_ms) FROM heartbeats WHERE monitor_id=? AND created_at>=? AND status='up') AS max_latency_24h`,
  )
    .bind(id, now - DAY, id, now - DAY, id, now - 7 * DAY, id, now - 7 * DAY, id, now - 30 * DAY, id, now - 30 * DAY, id, now - DAY, id, now - DAY)
    .first<Record<string, number>>();
  const s = row ?? {};
  const pct = (t: number, u: number) => (t > 0 ? Math.round((u / t) * 100) : null);
  return c.json({
    ok: true,
    data: {
      uptime_24h: pct((s.t24 ?? 0), (s.u24 ?? 0)),
      uptime_7d: pct((s.t7 ?? 0), (s.u7 ?? 0)),
      uptime_30d: pct((s.t30 ?? 0), (s.u30 ?? 0)),
      hb_24h_total: s.t24 ?? 0,
      avg_latency_24h: s.avg_latency_24h ?? null,
      max_latency_24h: s.max_latency_24h ?? null,
    },
  });
});

// 清空该监控的全部心跳（详情页「清空记录」，前端带二次确认）
monitorRoutes.delete("/:id/heartbeats", async (c) => {
  const id = Number(c.req.param("id"));
  const monitor = await c.env.DB.prepare("SELECT * FROM monitors WHERE id=?").bind(id).first();
  if (!monitor) return c.json({ ok: false, error: "监控不存在" }, 404);
  const r = await c.env.DB.prepare("DELETE FROM heartbeats WHERE monitor_id=?").bind(id).run();
  return c.json({ ok: true, data: { deleted: r.meta.changes ?? 0 } });
});

monitorRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  // batch 是原子事务：避免「心跳删了、监控还在」的半删状态
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM heartbeats WHERE monitor_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM monitors WHERE id=?").bind(id),
  ]);
  return c.json({ ok: true, data: null });
});

export default monitorRoutes;
