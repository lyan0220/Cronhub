import { Hono } from "hono";
import { getStatusPage, setStatusPage, type StatusPageConfig } from "../settings";
import type { Env } from "../types";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DEFAULT_TITLE = "服务状态";
const MAX_MONITORS = 20;

const statusPageRoutes = new Hono<{ Bindings: Env }>();

statusPageRoutes.get("/", async (c) => {
  const cfg = await getStatusPage(c.env);
  return c.json({
    ok: true,
    data: { config: cfg ?? { enabled: 0, slug: "", title: DEFAULT_TITLE, monitor_ids: [] } },
  });
});

statusPageRoutes.put("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as never);
  const enabled = body.enabled === 1 || body.enabled === true ? 1 : 0;
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const ids = Array.isArray(body.monitor_ids) ? body.monitor_ids : [];
  const monitor_ids = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

  // 关闭状态允许空草稿（slug/监控都不校验），重新打开时再按完整规则校验
  if (enabled) {
    if (!slug || slug.length > 50 || !SLUG_RE.test(slug)) {
      return c.json({ ok: false, error: "公开路径仅支持小写字母、数字与中划线（≤50 字符）" }, 400);
    }
    if (!title || title.length > 60) {
      return c.json({ ok: false, error: "页面标题必填（≤60 字）" }, 400);
    }
    if (monitor_ids.length === 0) {
      return c.json({ ok: false, error: "至少选择一个要公开的监控" }, 400);
    }
    if (monitor_ids.length > MAX_MONITORS) {
      return c.json({ ok: false, error: `最多公开 ${MAX_MONITORS} 个监控` }, 400);
    }
    const rows = await c.env.DB.prepare("SELECT id FROM monitors WHERE enabled=1").all<{ id: number }>();
    const eligible = new Set((rows.results ?? []).map((r) => r.id));
    // 配置可能来自监控删除前的旧状态；保存时清除不存在或已停用的 ID，避免脏数据阻塞编辑。
    const validIds = monitor_ids.filter((id) => eligible.has(id));
    if (validIds.length === 0) {
      return c.json({ ok: false, error: "至少选择一个启用中的监控" }, 400);
    }
    monitor_ids.splice(0, monitor_ids.length, ...validIds);
  }

  const config: StatusPageConfig = { enabled, slug, title: title || DEFAULT_TITLE, monitor_ids };
  await setStatusPage(c.env, config);
  return c.json({ ok: true, data: { config } });
});

export default statusPageRoutes;
