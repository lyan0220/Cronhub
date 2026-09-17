import { Hono } from "hono";
import { DEFAULT_RUN_RETENTION_DAYS, KEY_RUNS_RETENTION, getSetting, setSetting } from "../settings";
import type { Env } from "../types";

const runRoutes = new Hono<{ Bindings: Env }>();
const PAGE_SIZE = 50;

/** 状态互斥：失败包含触发与执行失败；成功仅包含执行成功及未追踪的触发成功历史行。 */
const STATUS_FILTERS: Record<string, string> = {
  failed: "(r.status='failed' OR (r.status='success' AND r.gh_state='done' AND COALESCE(r.gh_conclusion,'')!='success'))",
  success: "(r.status='success' AND (r.gh_state IS NULL OR (r.gh_state='done' AND r.gh_conclusion='success')))",
  running: "(r.status='success' AND r.gh_state='running')",
  waiting: "(r.status='success' AND r.gh_state='waiting')",
  unknown: "(r.status='success' AND r.gh_state='unknown')",
};

runRoutes.get("/", async (c) => {
  const jobId = Number(c.req.query("job_id") ?? 0);
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  // 旧链接可能带 gh= 参数（上一版的两段式筛选），按同语义迁移
  const statusKey = c.req.query("status") ?? c.req.query("gh") ?? "";
  const statusCond = Object.hasOwn(STATUS_FILTERS, statusKey) ? STATUS_FILTERS[statusKey] : undefined;
  const offset = (page - 1) * PAGE_SIZE;
  const conds: string[] = [];
  const binds: (number | string)[] = [];
  if (jobId > 0) { conds.push("r.job_id=?"); binds.push(jobId); }
  if (statusCond) conds.push(statusCond);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const cnt = await c.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM runs r ${where}`)
    .bind(...binds)
    .first<{ cnt: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT r.*, j.name AS job_name FROM runs r LEFT JOIN jobs j ON r.job_id=j.id ${where} ORDER BY r.triggered_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, PAGE_SIZE, offset)
    .all();
  return c.json({ ok: true, data: { total: cnt?.cnt ?? 0, page, rows: rows.results ?? [] } });
});

runRoutes.get("/retention", async (c) => {
  const v = await getSetting(c.env, KEY_RUNS_RETENTION);
  const days = Number(v);
  return c.json({ ok: true, data: { days: Number.isFinite(days) && days > 0 ? days : DEFAULT_RUN_RETENTION_DAYS } });
});

runRoutes.put("/retention", async (c) => {
  const body = await c.req.json<{ days?: unknown }>().catch(() => ({}) as never);
  const days = body.days;
  if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 3650) {
    return c.json({ ok: false, error: "保留期必须是 1-3650 的整数（天）" }, 400);
  }
  await setSetting(c.env, KEY_RUNS_RETENTION, String(days));
  return c.json({ ok: true, data: { days } });
});

runRoutes.post("/cleanup", async (c) => {
  const body = await c.req.json<{ days?: unknown; failedOnly?: unknown }>().catch(() => ({}) as never);
  const days = Number.isInteger(body.days) && (body.days as number) > 0 ? (body.days as number) : DEFAULT_RUN_RETENTION_DAYS;
  if (days > 3650) return c.json({ ok: false, error: "保留天数不能超过 3650" }, 400);
  const failedOnly = body.failedOnly === true;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const r = failedOnly
    ? await c.env.DB.prepare("DELETE FROM runs WHERE triggered_at < ? AND status='failed'").bind(cutoff).run()
    : await c.env.DB.prepare("DELETE FROM runs WHERE triggered_at < ?").bind(cutoff).run();
  return c.json({ ok: true, data: { deleted: r.meta.changes ?? 0 } });
});

export default runRoutes;
