import { describe, it, expect, beforeEach } from "vitest";
import authRoutes, { _resetLoginRateLimit } from "../src/server/routes/auth";

const env = { ADMIN_PASSWORD: "pw123", TOKEN_ENC_KEY: "k" };

function req(path: string, init?: RequestInit) {
  return authRoutes.request(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
  }, env);
}

describe("auth 路由", () => {
  beforeEach(() => _resetLoginRateLimit());

  it("正确密码登录成功并种下 Cookie", async () => {
    const res = await req("/login", { method: "POST", body: JSON.stringify({ password: "pw123" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("session=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await res.json()).toEqual({ ok: true, data: null });
  });
  it("错误密码返回 401", async () => {
    const res = await req("/login", { method: "POST", body: JSON.stringify({ password: "wrong" }) });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { ok?: boolean };
    expect(json.ok).toBe(false);
  });
  it("连续 5 次失败后锁定 10 分钟", async () => {
    for (let i = 0; i < 5; i++) await req("/login", { method: "POST", body: JSON.stringify({ password: "wrong" }) });
    const res = await req("/login", { method: "POST", body: JSON.stringify({ password: "pw123" }) });
    expect(res.status).toBe(429);
  });
  it("logout 清除 Cookie", async () => {
    const res = await req("/logout", { method: "POST" });
    expect(res.headers.get("set-cookie")).toContain("session=");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("me 带有效会话返回 200，否则 401", async () => {
    const login = await req("/login", { method: "POST", body: JSON.stringify({ password: "pw123" }) });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const ok = await req("/me", { headers: { Cookie: cookie } });
    expect(ok.status).toBe(200);
    const bad = await req("/me", { headers: { Cookie: "session=123.abc" } });
    expect(bad.status).toBe(401);
  });
});
