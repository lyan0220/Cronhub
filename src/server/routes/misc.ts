import { Hono } from "hono";
import { describeSchedule, isValidTimezone, previewRuns, validateSchedule } from "../schedule";
import { KEY_SCHEDULER_HEARTBEAT, getSetting } from "../settings";
import type { Env } from "../types";

const miscRoutes = new Hono<{ Bindings: Env }>();

miscRoutes.get("/stats", async (c) => {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const [row, heartbeat] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM accounts) AS accounts,
         (SELECT COUNT(*) FROM jobs) AS total_jobs,
         (SELECT COUNT(*) FROM jobs WHERE enabled=1) AS enabled_jobs,
         (SELECT COUNT(*) FROM runs WHERE triggered_at>=?) AS today_runs,
         (SELECT COUNT(*) FROM runs WHERE triggered_at>=? AND status='failed') AS failed_24h,
         (SELECT COUNT(*) FROM runs WHERE triggered_at>=? AND status='success'
            AND gh_state='done' AND COALESCE(gh_conclusion,'')!='success') AS gh_failed_24h,
         (SELECT COUNT(*) FROM runs WHERE triggered_at>=? AND gh_state='done') AS gh_done_7d,
         (SELECT COUNT(*) FROM runs WHERE triggered_at>=? AND gh_state='done'
            AND gh_conclusion='success') AS gh_success_7d`,
    )
      .bind(dayStart.getTime(), Date.now() - 24 * 3600 * 1000, Date.now() - 24 * 3600 * 1000, weekAgo, weekAgo)
      .first(),
    getSetting(c.env, KEY_SCHEDULER_HEARTBEAT),
  ]);
  const hb = Number(heartbeat);
  const base = row ?? {};
  // 近 7 天 workflow 成功率（分母为已有结论的 run；无结论时 null，前端隐藏该卡）
  const ghDone = (base.gh_done_7d as number) ?? 0;
  const ghSuccess = (base.gh_success_7d as number) ?? 0;
  const successRate7d = ghDone > 0 ? Math.round((ghSuccess / ghDone) * 100) : null;
  return c.json({
    ok: true,
    data: { ...base, success_rate_7d: successRate7d, scheduler_last_run_at: Number.isFinite(hb) && hb > 0 ? hb : null },
  });
});

miscRoutes.get("/cron/preview", async (c) => {
  const raw = c.req.query("rule");
  if (!raw) return c.json({ ok: false, error: "缺少 rule 参数" }, 400);
  const tz = c.req.query("tz") || undefined;
  if (tz && !isValidTimezone(tz)) return c.json({ ok: false, error: "时区名称无效" }, 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ ok: false, error: "rule 不是合法 JSON" }, 400);
  }
  const v = validateSchedule(parsed);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  return c.json({ ok: true, data: { times: previewRuns(v.rule, 5, tz), describe: describeSchedule(v.rule) } });
});

export default miscRoutes;
