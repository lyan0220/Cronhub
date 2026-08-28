import { Hono } from "hono";
import { describeSchedule, previewRuns, validateSchedule } from "../schedule";
import type { Env } from "../types";

const miscRoutes = new Hono<{ Bindings: Env }>();

miscRoutes.get("/stats", async (c) => {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM accounts) AS accounts,
       (SELECT COUNT(*) FROM jobs) AS total_jobs,
       (SELECT COUNT(*) FROM jobs WHERE enabled=1) AS enabled_jobs,
       (SELECT COUNT(*) FROM runs WHERE triggered_at>=?) AS today_runs,
       (SELECT COUNT(*) FROM runs WHERE triggered_at>=? AND status='failed') AS failed_24h`,
  )
    .bind(dayStart.getTime(), Date.now() - 24 * 3600 * 1000)
    .first();
  return c.json({ ok: true, data: row ?? {} });
});

miscRoutes.get("/cron/preview", async (c) => {
  const raw = c.req.query("rule");
  if (!raw) return c.json({ ok: false, error: "缺少 rule 参数" }, 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ ok: false, error: "rule 不是合法 JSON" }, 400);
  }
  const v = validateSchedule(parsed);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  return c.json({ ok: true, data: { times: previewRuns(v.rule, 5), describe: describeSchedule(v.rule) } });
});

export default miscRoutes;
