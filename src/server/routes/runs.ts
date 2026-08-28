import { Hono } from "hono";
import type { Env } from "../types";

const runRoutes = new Hono<{ Bindings: Env }>();
const PAGE_SIZE = 50;

runRoutes.get("/", async (c) => {
  const jobId = Number(c.req.query("job_id") ?? 0);
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const where = jobId > 0 ? "WHERE r.job_id=?" : "";
  const binds = jobId > 0 ? [jobId] : [];

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

runRoutes.post("/cleanup", async (c) => {
  const body = await c.req.json<{ days?: unknown }>().catch(() => ({}) as never);
  const days = Number.isInteger(body.days) && (body.days as number) > 0 ? body.days as number : 90;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const r = await c.env.DB.prepare("DELETE FROM runs WHERE triggered_at < ?").bind(cutoff).run();
  return c.json({ ok: true, data: { deleted: r.meta.changes ?? 0 } });
});

export default runRoutes;
