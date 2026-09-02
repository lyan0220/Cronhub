import { Hono } from "hono";
import { hashPassword, verifyPassword, verifyPasswordHash } from "../crypto";
import { getAuthState, invalidateAuthState, KEY_PASSWORD_HASH, KEY_SESSION_EPOCH, setSetting } from "../settings";
import type { Env } from "../types";

// 修改管理员密码。挂在 requireAuth 之后（worker.ts 的 protectedApi），
// 只需要当前会话有效 + 当前密码正确。
const passwordRoutes = new Hono<{ Bindings: Env }>();

passwordRoutes.post("/", async (c) => {
  const body = await c.req.json<{ current?: unknown; next?: unknown }>().catch(() => ({}) as never);
  const current = typeof body.current === "string" ? body.current : "";
  const next = typeof body.next === "string" ? body.next : "";
  if (next.length < 8) return c.json({ ok: false, error: "新密码至少 8 位" }, 400);
  if (next.length > 100) return c.json({ ok: false, error: "新密码过长（≤100 位）" }, 400);

  const state = await getAuthState(c.env);
  const currentOk = state.hash
    ? await verifyPasswordHash(state.hash, current)
    : await verifyPassword(current, c.env.ADMIN_PASSWORD);
  if (!currentOk) return c.json({ ok: false, error: "当前密码不正确" }, 400);
  if (current === next) return c.json({ ok: false, error: "新密码不能与当前密码相同" }, 400);

  // 哈希入库 + 会话纪元 +1：正在使用的这个会话也会立刻失效，客户端改密成功后
  // 直接跳回登录页。batch 保证两条写入同生共死。
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)")
      .bind(KEY_PASSWORD_HASH, await hashPassword(next)),
    c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)")
      .bind(KEY_SESSION_EPOCH, String(state.epoch + 1)),
  ]);
  invalidateAuthState();
  return c.json({ ok: true, data: null });
});

export default passwordRoutes;
