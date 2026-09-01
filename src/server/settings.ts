// settings 表读写 + 认证状态的 isolate 级缓存。
// 缓存只为给 requireAuth 省一次 D1 读：每个 isolate 每 60 秒最多回源一次；
// 改密路由写库后立即失效缓存，其他 isolate 最迟 60 秒内收敛。
import type { Env } from "./types";

export const KEY_PASSWORD_HASH = "admin_password_hash";
export const KEY_SESSION_EPOCH = "session_epoch";

type AuthState = { hash: string | null; epoch: number };

let cache: (AuthState & { at: number }) | null = null;
const CACHE_TTL = 60_000;

export async function getAuthState(env: Env): Promise<AuthState> {
  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return { hash: cache.hash, epoch: cache.epoch };
  }
  const [hashRow, epochRow] = await Promise.all([
    env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(KEY_PASSWORD_HASH)
      .first<{ value: string }>(),
    env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(KEY_SESSION_EPOCH)
      .first<{ value: string }>(),
  ]);
  const state: AuthState = {
    hash: hashRow?.value ?? null,
    epoch: Number(epochRow?.value ?? 0) || 0,
  };
  cache = { ...state, at: Date.now() };
  return state;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)")
    .bind(key, value)
    .run();
}

export function invalidateAuthState(): void {
  cache = null;
}

/** 测试隔离用：beforeEach 里清掉模块级缓存 */
export function _resetAuthState(): void {
  cache = null;
}
