import { Hono } from "hono";
import { computeNextRun, isValidTimezone, validateSchedule, type ScheduleRule } from "../schedule";
import { triggerJobOnce } from "../scheduler";
import type { Env, JobRow } from "../types";

const jobRoutes = new Hono<{ Bindings: Env }>();

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
// workflow 文件名（可含子目录，如 build/test.yml，也接受数字 ID）与分支/标签 ref
// （feature/x、release/v1.0、refs/heads/main、40 位 SHA）的公共字符集：\w . / -。
// 旧版用 [\w.-]+ 把斜杠挡在了外面，feature/x 这类最常见的分支名直接 400。
const SLUG_RE = /^(?!-)[\w.\-/]+(?<![\/.])$/;

/** git check-ref-format 的关键规则子集：不以 - 或 . 开头、不含 ..、不以 .lock 结尾。 */
function isValidRef(ref: string): boolean {
  return SLUG_RE.test(ref) && !ref.startsWith(".") && !ref.includes("..") && !ref.endsWith(".lock");
}

/** 校验所选通知渠道都存在（渠道可能被并发删除）；返回错误文案或 null */
async function assertChannelsExist(env: Env, idsJson: string | null): Promise<string | null> {
  if (!idsJson) return null;
  const ids = JSON.parse(idsJson) as number[];
  const rows = await env.DB.prepare("SELECT id FROM notify_channels").all<{ id: number }>();
  const known = new Set((rows.results ?? []).map((r) => r.id));
  const missing = ids.filter((id) => !known.has(id));
  return missing.length ? `通知渠道不存在（id: ${missing.join(", ")}），请重新选择` : null;
}

type JobInput = {
  name: string;
  account_id: number;
  repo: string;
  trigger_type: "workflow_dispatch" | "repository_dispatch";
  workflow_id: string | null;
  event_type: string | null;
  ref: string | null;
  inputs_json: string | null;
  notify: number;
  notify_channel_ids: string | null;
  timezone: string | null;
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
    if (!SLUG_RE.test(workflow_id)) return { ok: false, error: "请填写 workflow 文件名（如 run.yml）或 workflow ID" };
    ref = typeof body.ref === "string" && body.ref.trim() ? body.ref.trim() : "main";
    if (!isValidRef(ref)) return { ok: false, error: "分支 / 标签名非法（如 main、feature/x、v1.0）" };
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
  // 失败通知默认关闭，需要显式开启
  const notify = body.notify === 1 || body.notify === true ? 1 : 0;
  // 失败通知渠道：数组（可多选）序列化为 JSON；缺省/空数组 = 全部渠道（NULL）
  let notify_channel_ids: string | null = null;
  if (Array.isArray(body.notify_channel_ids)) {
    const ids = [...new Set(body.notify_channel_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    notify_channel_ids = ids.length ? JSON.stringify(ids) : null;
  }
  let timezone: string | null = null;
  if (typeof body.timezone === "string" && body.timezone.trim()) {
    timezone = body.timezone.trim();
    if (!isValidTimezone(timezone)) return { ok: false, error: "时区名称无效（应为 IANA 时区，如 Asia/Shanghai）" };
  }
  return { ok: true, data: { name, account_id, repo, trigger_type, workflow_id, event_type, ref, inputs_json, notify, notify_channel_ids, timezone }, schedule: sv.rule, enabled };
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
  const chErr = await assertChannelsExist(c.env, v.data.notify_channel_ids);
  if (chErr) return c.json({ ok: false, error: chErr }, 400);

  const now = Date.now();
  const next_run_at = computeNextRun(v.schedule, now, Math.random, v.data.timezone ?? undefined);
  const r = await c.env.DB.prepare(
    "INSERT INTO jobs (name, account_id, repo, trigger_type, workflow_id, event_type, ref, inputs_json, schedule_json, notify, notify_channel_ids, timezone, enabled, next_run_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(v.data.name, v.data.account_id, v.data.repo, v.data.trigger_type, v.data.workflow_id, v.data.event_type,
      v.data.ref, v.data.inputs_json, JSON.stringify(v.schedule), v.data.notify, v.data.notify_channel_ids, v.data.timezone, v.enabled, next_run_at, now, now)
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
  const chErr = await assertChannelsExist(c.env, v.data.notify_channel_ids);
  if (chErr) return c.json({ ok: false, error: chErr }, 400);

  const now = Date.now();
  const next_run_at = computeNextRun(v.schedule, now, Math.random, v.data.timezone ?? undefined);
  await c.env.DB.prepare(
    "UPDATE jobs SET name=?, account_id=?, repo=?, trigger_type=?, workflow_id=?, event_type=?, ref=?, inputs_json=?, schedule_json=?, notify=?, notify_channel_ids=?, timezone=?, enabled=?, next_run_at=?, updated_at=? WHERE id=?",
  )
    .bind(v.data.name, v.data.account_id, v.data.repo, v.data.trigger_type, v.data.workflow_id, v.data.event_type,
      v.data.ref, v.data.inputs_json, JSON.stringify(v.schedule), v.data.notify, v.data.notify_channel_ids, v.data.timezone, v.enabled, next_run_at, now, id)
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
    // schedule_json 可能因历史数据损坏而无法解析，JSON.parse 直接抛出去就是 500。
    // 这里吞掉异常、沿用原 next_run_at：启用本身照常生效，调度器下一轮发现规则
    // 损坏会按既有逻辑跳过并推进冷却时间，任务列表里的「下次运行」暂时失真。
    try {
      const sv = validateSchedule(JSON.parse(job.schedule_json));
      if (sv.ok) nextRun = computeNextRun(sv.rule, Date.now());
    } catch { /* 规则损坏，保持原值 */ }
  }
  // 手动启停顺带清零 fail_streak：启停都是管理员在场操作，旧计数对下一次
  // 无人值守周期没有意义，也让「enabled=0 且 fail_streak>0」唯一表示自动停用。
  await c.env.DB.prepare("UPDATE jobs SET enabled=?, next_run_at=?, updated_at=?, fail_streak=0 WHERE id=?")
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
  // batch 是原子事务：原先两条顺序执行，中间失败会留下「runs 删了、job 还在」的半删状态
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM runs WHERE job_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM jobs WHERE id=?").bind(id),
  ]);
  return c.json({ ok: true, data: null });
});

export default jobRoutes;
