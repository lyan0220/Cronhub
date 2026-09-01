import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verifySessionToken } from "./crypto";
import { getAuthState } from "./settings";
import type { Env } from "./types";

// 挂载在 /api/*（auth 路由除外），校验签名会话 Cookie。
// getAuthState 有 60 秒 isolate 级缓存，正常请求不额外增加 D1 开销。
export const requireAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const token = getCookie(c, "session");
  const { epoch } = await getAuthState(c.env);
  if (!token || !(await verifySessionToken(token, c.env.ADMIN_PASSWORD, epoch))) {
    return c.json({ ok: false, error: "未登录" }, 401);
  }
  await next();
});
