import { Hono } from "hono";
import { getChannel, getChannels, isNotifyType, sendNotify, type ChannelRow } from "../notify";
import { KEY_AUTO_PAUSE_THRESHOLD, getAutoPauseThreshold, setSetting } from "../settings";
import type { Env } from "../types";

const notifyRoutes = new Hono<{ Bindings: Env }>();

const URL_RE = /^https:\/\//;

function validateBody(body: Record<string, unknown>): { ok: true; name: string; type: "wecom" | "feishu" | "telegram" | "bark" | "generic"; url: string | null } | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return { ok: false, error: "渠道名称必填（≤100 字）" };
  if (!isNotifyType(body.type)) return { ok: false, error: "通知渠道类型不合法" };
  // url 为空 = 编辑时保持原地址（不回填，避免误碰覆盖）
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (url && !URL_RE.test(url)) return { ok: false, error: "Webhook 地址必须是 https:// 开头的完整 URL" };
  return { ok: true, name, type: body.type, url: url || null };
}

function view(ch: ChannelRow) {
  return { id: ch.id, name: ch.name, type: ch.type, url: ch.url };
}

// ---- 渠道管理（地址明文返回：单管理员系统，页面内需可查看与二次编辑）----

notifyRoutes.get("/channels", async (c) => {
  const channels = await getChannels(c.env);
  return c.json({ ok: true, data: { channels: channels.map(view) } });
});

notifyRoutes.post("/channels", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as never);
  const v = validateBody(body);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  if (!v.url) return c.json({ ok: false, error: "Webhook 地址必填" }, 400);
  const now = Date.now();
  const r = await c.env.DB.prepare(
    "INSERT INTO notify_channels (name, type, url, created_at, updated_at) VALUES (?,?,?,?,?)",
  )
    .bind(v.name, v.type, v.url, now, now)
    .run();
  const row = await getChannel(c.env, r.meta.last_row_id);
  return c.json({ ok: true, data: row ? view(row) : null }, 201);
});

notifyRoutes.put("/channels/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const ch = await getChannel(c.env, id);
  if (!ch) return c.json({ ok: false, error: "渠道不存在" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as never);
  const v = validateBody(body);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  await c.env.DB.prepare(
    "UPDATE notify_channels SET name=?, type=?, url=?, updated_at=? WHERE id=?",
  )
    .bind(v.name, v.type, v.url ?? ch.url, Date.now(), id)
    .run();
  const row = await getChannel(c.env, id);
  return c.json({ ok: true, data: row ? view(row) : null });
});

notifyRoutes.delete("/channels/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const ch = await getChannel(c.env, id);
  if (!ch) return c.json({ ok: false, error: "渠道不存在" }, 404);
  await c.env.DB.prepare("DELETE FROM notify_channels WHERE id=?").bind(id).run();
  return c.json({ ok: true, data: null });
});

notifyRoutes.post("/channels/:id/test", async (c) => {
  const ch = await getChannel(c.env, Number(c.req.param("id")));
  if (!ch) return c.json({ ok: false, error: "渠道不存在" }, 404);
  const delivered = await sendNotify(ch, {
    event: "test",
    title: "Cronhub 测试通知",
    body: `这是一条发送到「${ch.name}」的测试消息。收到即说明该渠道配置正确。`,
  });
  if (!delivered) return c.json({ ok: false, error: "发送失败：Webhook 未返回成功状态，请检查地址是否有效" }, 502);
  return c.json({ ok: true, data: null });
});

// ---- 全局设置：连续失败自动停用阈值 ----

notifyRoutes.get("/config", async (c) => {
  return c.json({ ok: true, data: { auto_pause_threshold: await getAutoPauseThreshold(c.env) } });
});

notifyRoutes.put("/config", async (c) => {
  const body = await c.req.json<{ auto_pause_threshold?: unknown }>().catch(() => ({}) as never);
  const threshold = Number(body.auto_pause_threshold);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
    return c.json({ ok: false, error: "连续失败停用阈值必须是 0-100 的整数（0 = 不自动停用）" }, 400);
  }
  await setSetting(c.env, KEY_AUTO_PAUSE_THRESHOLD, String(threshold));
  return c.json({ ok: true, data: { auto_pause_threshold: threshold } });
});

export default notifyRoutes;
