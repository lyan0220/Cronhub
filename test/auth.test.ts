import { describe, it, expect, beforeEach } from "vitest";
import authRoutes from "../src/server/routes/auth";
import { _resetAuthState } from "../src/server/settings";
import { FakeD1 } from "./helpers/fake-d1";
import type { Env } from "../src/server/types";

/** 按 IP 计数的假 Ratelimit binding：每个 key 前 max 次放行。 */
function fakeRl(max: number) {
  const counts = new Map<string, number>();
  return {
    counts,
    limit: async ({ key }: { key: string }) => {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= max };
    },
  };
}

let db: FakeD1;
let rl: ReturnType<typeof fakeRl>;
let env: Env;
beforeEach(() => {
  db = new FakeD1();
  rl = fakeRl(5);
  env = { DB: db as unknown as D1Database, ASSETS: null as never, ADMIN_PASSWORD: "pw123", TOKEN_ENC_KEY: "k", RATE_LIMITER: rl as never };
  // getAuthState 有模块级缓存，不清掉会污染下一个用例的新 env
  _resetAuthState();
});

function req(path: string, init?: RequestInit, opts?: { env?: Env; ip?: string }) {
  return authRoutes.request(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": opts?.ip ?? "1.1.1.1",
      ...(init?.headers as Record<string, string>),
    },
  }, opts?.env ?? env);
}

const wrong = { method: "POST", body: JSON.stringify({ password: "wrong" }) };
const right = { method: "POST", body: JSON.stringify({ password: "pw123" }) };

describe("auth 路由", () => {
  it("正确密码登录成功并种下 Cookie", async () => {
    const res = await req("/login", right);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("session=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await res.json()).toEqual({ ok: true, data: null });
  });
  it("错误密码返回 401", async () => {
    const res = await req("/login", wrong);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { ok?: boolean };
    expect(json.ok).toBe(false);
  });
  it("同一 IP 连续 6 次失败，第 6 次拿到 429", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await req("/login", wrong);
      expect(res.status).toBe(401);
    }
    const res = await req("/login", wrong);
    expect(res.status).toBe(429);
    expect(rl.counts.get("1.1.1.1")).toBe(6);
  });
  it("失败 5 次后正确密码仍能登录（成功不消耗配额，不再锁死管理员）", async () => {
    for (let i = 0; i < 5; i++) await req("/login", wrong);
    const res = await req("/login", right);
    expect(res.status).toBe(200);
  });
  it("不同 IP 各自计数，互不影响", async () => {
    for (let i = 0; i < 5; i++) await req("/login", wrong, { ip: "1.1.1.1" });
    const sixth = await req("/login", wrong, { ip: "1.1.1.1" });
    expect(sixth.status).toBe(429);
    // 换一个 IP：计数独立，仍走正常的失败路径
    const other = await req("/login", wrong, { ip: "2.2.2.2" });
    expect(other.status).toBe(401);
  });
  it("未注入 RATE_LIMITER 时不限速也不崩溃（始终 401）", async () => {
    const bare: Env = { DB: db as unknown as D1Database, ASSETS: null as never, ADMIN_PASSWORD: "pw123", TOKEN_ENC_KEY: "k" };
    for (let i = 0; i < 7; i++) {
      const res = await req("/login", wrong, { env: bare });
      expect(res.status).toBe(401);
    }
  });
  it("logout 清除 Cookie", async () => {
    const res = await req("/logout", { method: "POST" });
    expect(res.headers.get("set-cookie")).toContain("session=");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("me 带有效会话返回 200，否则 401", async () => {
    const login = await req("/login", right);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const ok = await req("/me", { headers: { Cookie: cookie } });
    expect(ok.status).toBe(200);
    const bad = await req("/me", { headers: { Cookie: "session=123.abc" } });
    expect(bad.status).toBe(401);
  });
  it("改密后：D1 哈希生效登录、环境变量密码失效、旧 epoch 会话 401", async () => {
    // 模拟改密路由的落库结果
    const { hashPassword } = await import("../src/server/crypto");
    db.settings.set("admin_password_hash", await hashPassword("brand-new-pw-1"));
    db.settings.set("session_epoch", "1");
    _resetAuthState();
    // 环境变量密码不再可用
    const oldLogin = await req("/login", { method: "POST", body: JSON.stringify({ password: "pw123" }) });
    expect(oldLogin.status).toBe(401);
    // 新密码可登录
    const newLogin = await req("/login", { method: "POST", body: JSON.stringify({ password: "brand-new-pw-1" }) });
    expect(newLogin.status).toBe(200);
    // 旧 epoch（0）的令牌失效
    const stale = await req("/me", { headers: { Cookie: "session=0.999999999999.AAAA" } });
    expect(stale.status).toBe(401);
  });
});
