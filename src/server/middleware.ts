import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verifySessionToken } from "./crypto";
import type { Env } from "./types";

// 挂载在 /api/*（auth 路由除外），校验签名会话 Cookie
export const requireAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const token = getCookie(c, "session");
  if (!token || !(await verifySessionToken(token, c.env.ADMIN_PASSWORD))) {
    return c.json({ ok: false, error: "未登录" }, 401);
  }
  await next();
});
