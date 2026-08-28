import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createSessionToken, verifyPassword, verifySessionToken } from "../crypto";
import type { Env } from "../types";

// 内存级登录限速：连续错 5 次锁 10 分钟（单管理密码场景够用；
// Worker 实例重启会清零，属可接受的折衷）
let fails = 0;
let lockedUntil = 0;
export function _resetLoginRateLimit() {
  fails = 0;
  lockedUntil = 0;
}

const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post("/login", async (c) => {
  if (Date.now() < lockedUntil) {
    return c.json({ ok: false, error: "尝试次数过多，请 10 分钟后再试" }, 429);
  }
  let password = "";
  try {
    const body = await c.req.json<{ password?: unknown }>();
    if (typeof body.password === "string") password = body.password;
  } catch { /* 视为空密码 */ }
  if (!password || !(await verifyPassword(password, c.env.ADMIN_PASSWORD))) {
    fails++;
    if (fails >= 5) {
      lockedUntil = Date.now() + 10 * 60_000;
      fails = 0;
    }
    return c.json({ ok: false, error: "密码错误" }, 401);
  }
  fails = 0;
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
