import { Hono } from "hono";
import { computeNextRun, validateSchedule, type ScheduleRule } from "../schedule";
import { triggerJobOnce } from "../scheduler";
import type { Env, JobRow } from "../types";

const jobRoutes = new Hono<{ Bindings: Env }>();

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const WORKFLOW_RE = /^[\w.-]+$/;

type JobInput = {
  name: string;
  account_id: number;
  repo: string;
  trigger_type: "workflow_dispatch" | "repository_dispatch";
  workflow_id: string | null;
  event_type: string | null;
  ref: string | null;
  inputs_json: string | null;
};

function validateJobBody(body: Record<string, unknown>): { ok: true; data: JobInput; schedule: ScheduleRule; enabled: number } | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return { ok: false, error: "任务名必填（≤100 字）" };
  const account_id = Number(body.account_id);
  if (!Number.isInteger(account_id) || account_id < 1) return { ok: false, error: "请选择账号" };
  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  if (!REPO_RE.test(repo)) return { ok: false, error: "仓库格式应为 owner/repo" };
  const trigger_type = body.trigger_type;
  if (trigger_type !== "workflow_dispatch" && trigger_type !== "repository_dispatch")
    return { ok: false, error: "触发类型必须是 workflow_dispatch / repository_dispatch" };

  let workflow_id: string | null = null;
  let event_type: string | null = null;
  let ref: string | null = null;
  if (trigger_type === "workflow_dispatch") {
    workflow_id = typeof body.workflow_id === "string" ? body.workflow_id.trim() : "";
    if (!WORKFLOW_RE.test(workflow_id)) return { ok: false, error: "请填写 workflow 文件名（如 run.yml）或 workflow ID" };
    ref = typeof body.ref === "string" && body.ref.trim() ? body.ref.trim() : "main";
    if (!WORKFLOW_RE.test(ref)) return { ok: false, error: "分支名非法" };
  } else {
    event_type = typeof body.event_type === "string" ? body.event_type.trim() : "";
    if (!event_type || event_type.length > 100) return { ok: false, error: "请填写 repository_dispatch 事件类型" };
  }

  let inputs_json: string | null = null;
  if (typeof body.inputs_json === "string" && body.inputs_json.trim()) {
    try {
      const v = JSON.parse(body.inputs_json);
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
    } catch {
      return { ok: false, error: "inputs / payload 必须是 JSON 对象" };
    }
    inputs_json = body.inputs_json.trim();
  }

  const sv = validateSchedule(body.schedule);
  if (!sv.ok) return { ok: false, error: sv.error };

  const enabled = body.enabled === 0 || body.enabled === false ? 0 : 1;
  return { ok: true, data: { name, account_id, repo, trigger_type, workflow_id, event_type, ref, inputs_json }, schedule: sv.rule, enabled };
}

jobRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT j.*, a.name AS account_name FROM jobs j LEFT JOIN accounts a ON j.account_id=a.id ORDER BY j.id DESC",
  ).all();
  return c.json({ ok: true, data: rows.results ?? [] });
});

jobRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as never);
  const v = validateJobBody(body);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  const acc = await c.env.DB.prepare("SELECT id FROM accounts WHERE id=?").bind(v.data.account_id).first();
  if (!acc) return c.json({ ok: false, error: "所选账号不存在" }, 400);

  const now = Date.now();
  const next_run_at = computeNextRun(v.schedule, now);
  const r = await c.env.DB.prepare(
    "INSERT INTO jobs (name, account_id, repo, trigger_type, workflow_id, event_type, ref, inputs_json, schedule_json, enabled, next_run_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(v.data.name, v.data.account_id, v.data.repo, v.data.trigger_type, v.data.workflow_id, v.data.event_type,
      v.data.ref, v.data.inputs_json, JSON.stringify(v.schedule), v.enabled, next_run_at, now, now)
    .run();
  const job = await c.env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(r.meta.last_row_id).first<JobRow>();
  return c.json({ ok: true, data: job }, 201);
});

jobRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const job = await c.env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<JobRow>();
  if (!job) return c.json({ ok: false, error: "任务不存在" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as never);
  const v = validateJobBody(body);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  const acc = await c.env.DB.prepare("SELECT id FROM accounts WHERE id=?").bind(v.data.account_id).first();
  if (!acc) return c.json({ ok: false, error: "所选账号不存在" }, 400);

  const now = Date.now();
  const next_run_at = computeNextRun(v.schedule, now);
  await c.env.DB.prepare(
    "UPDATE jobs SET name=?, account_id=?, repo=?, trigger_type=?, workflow_id=?, event_type=?, ref=?, inputs_json=?, schedule_json=?, enabled=?, next_run_at=?, updated_at=? WHERE id=?",
  )
    .bind(v.data.name, v.data.account_id, v.data.repo, v.data.trigger_type, v.data.workflow_id, v.data.event_type,
      v.data.ref, v.data.inputs_json, JSON.stringify(v.schedule), v.enabled, next_run_at, now, id)
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<JobRow>();
  return c.json({ ok: true, data: updated });
});

jobRoutes.post("/:id/toggle", async (c) => {
  const id = Number(c.req.param("id"));
  const job = await c.env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<JobRow>();
  if (!job) return c.json({ ok: false, error: "任务不存在" }, 404);
  const newEnabled = job.enabled === 1 ? 0 : 1;
  let nextRun = job.next_run_at;
  if (newEnabled === 1) {
    const sv = validateSchedule(JSON.parse(job.schedule_json));
    if (sv.ok) nextRun = computeNextRun(sv.rule, Date.now());
  }
  await c.env.DB.prepare("UPDATE jobs SET enabled=?, next_run_at=?, updated_at=? WHERE id=?")
    .bind(newEnabled, nextRun, Date.now(), id).run();
  return c.json({ ok: true, data: { enabled: newEnabled, next_run_at: nextRun } });
});

jobRoutes.post("/:id/trigger", async (c) => {
  const result = await triggerJobOnce(c.env, Number(c.req.param("id")), "manual");
  if ("notFound" in result) return c.json({ ok: false, error: "任务不存在" }, 404);
  if (!result.ok) return c.json({ ok: false, error: result.error ?? "触发失败" }, 502);
  return c.json({ ok: true, data: null });
});

jobRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM runs WHERE job_id=?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM jobs WHERE id=?").bind(id).run();
  return c.json({ ok: true, data: null });
});

export default jobRoutes;
