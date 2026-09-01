import { describe, it, expect, beforeEach } from "vitest";
import passwordRoutes from "../src/server/routes/password";
import { createSessionToken, verifySessionToken } from "../src/server/crypto";
import { _resetAuthState } from "../src/server/settings";
import { FakeD1 } from "./helpers/fake-d1";
import type { Env } from "../src/server/types";

let db: FakeD1;
let env: Env;

beforeEach(() => {
  db = new FakeD1();
  env = { DB: db as unknown as D1Database, ASSETS: null as never, ADMIN_PASSWORD: "old-pw-123", TOKEN_ENC_KEY: "k" };
  _resetAuthState();
});

function req(path: string, init?: RequestInit) {
  return passwordRoutes.request(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
  }, env);
}

const changeBody = { method: "POST", body: JSON.stringify({ current: "old-pw-123", next: "new-pw-456789" }) };

describe("修改管理员密码", () => {
  it("改密成功：哈希入库、epoch +1", async () => {
    const res = await req("/", changeBody);
    expect(res.status).toBe(200);
    expect(db.settings.get("admin_password_hash")).toMatch(/^pbkdf2-sha256\$/);
    expect(db.settings.get("session_epoch")).toBe("1");
  });

  it("当前密码错误返回 400", async () => {
    const res = await req("/", {
      method: "POST",
      body: JSON.stringify({ current: "wrong", next: "new-pw-456789" }),
    });
    expect(res.status).toBe(400);
    expect(db.settings.size).toBe(0);
  });

  it("新密码少于 8 位返回 400", async () => {
    const res = await req("/", {
      method: "POST",
      body: JSON.stringify({ current: "old-pw-123", next: "short" }),
    });
    expect(res.status).toBe(400);
  });

  it("改密后旧密码无法通过哈希校验，新密码可以", async () => {
    await req("/", changeBody);
    const hash = db.settings.get("admin_password_hash")!;
    const { verifyPasswordHash } = await import("../src/server/crypto");
    expect(await verifyPasswordHash(hash, "new-pw-456789")).toBe(true);
    expect(await verifyPasswordHash(hash, "old-pw-123")).toBe(false);
  });

  it("epoch 让旧会话失效：改密前签发的令牌在改密后校验失败", async () => {
    const oldToken = await createSessionToken(env.ADMIN_PASSWORD, 0);
    await req("/", changeBody);
    // 改密后 epoch=1
    const { getAuthState } = await import("../src/server/settings");
    const state = await getAuthState(env);
    expect(await verifySessionToken(oldToken, env.ADMIN_PASSWORD, state.epoch)).toBe(false);
    const newToken = await createSessionToken(env.ADMIN_PASSWORD, state.epoch);
    expect(await verifySessionToken(newToken, env.ADMIN_PASSWORD, state.epoch)).toBe(true);
  });

  it("新密码与当前密码相同返回 400", async () => {
    const res = await req("/", {
      method: "POST",
      body: JSON.stringify({ current: "old-pw-123", next: "old-pw-123" }),
    });
    expect(res.status).toBe(400);
  });
});
