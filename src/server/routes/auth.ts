import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createSessionToken, verifyPassword, verifySessionToken } from "../crypto";
import type { Env } from "../types";

// 登录限速：只统计「失败」，按 IP 每 60 秒 5 次（配额在 wrangler.jsonc 的
// ratelimits 里配置——binding 的 simple 变体只支持 10/60 秒窗口），走 Workers
// Ratelimit binding——跨实例共享计数，实例重启不丢。原先的模块级内存计数有
// 两个问题：多实例各自计数，分布式爆破轻松绕过；且不分 IP，攻击者错 5 次就把
// 全局锁 10 分钟，等于把合法管理员也锁在门外。按 IP 仍有 NAT 共享出口的误伤
// 可能，属该方案的固有取舍。
const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post("/login", async (c) => {
  let password = "";
  try {
    const body = await c.req.json<{ password?: unknown }>();
    if (typeof body.password === "string") password = body.password;
  } catch { /* 视为空密码 */ }
  const ok = !!password && (await verifyPassword(password, c.env.ADMIN_PASSWORD));
  if (!ok) {
    // 只在失败路径上消耗配额：成功登录永远不计数，管理员输错几次也不会被锁。
    // 第 RL_LIMIT+1 次失败拿到 429。
    const rl = c.env.RATE_LIMITER;
    if (rl) {
      const key = c.req.header("CF-Connecting-IP") ?? "unknown";
      const r = await rl.limit({ key });
      if (!r.success) return c.json({ ok: false, error: "尝试次数过多，请稍后再试" }, 429);
    }
    return c.json({ ok: false, error: "密码错误" }, 401);
  }
  const token = await createSessionToken(c.env.ADMIN_PASSWORD);
  setCookie(c, "session", token, {
    httpOnly: true,
    secure: true, // localhost 下现代浏览器同样接受 Secure Cookie
    sameSite: "Strict",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
  return c.json({ ok: true, data: null });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true, data: null });
});

authRoutes.get("/me", async (c) => {
  const token = getCookie(c, "session");
  if (token && (await verifySessionToken(token, c.env.ADMIN_PASSWORD))) {
    return c.json({ ok: true, data: null });
  }
  return c.json({ ok: false, error: "未登录" }, 401);
});

export default authRoutes;
