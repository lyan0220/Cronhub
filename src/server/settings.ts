// settings 表读写 + 认证状态的 isolate 级缓存。
// 缓存只为给 requireAuth 省一次 D1 读：每个 isolate 每 60 秒最多回源一次；
// 改密路由写库后立即失效缓存，其他 isolate 最迟 60 秒内收敛。
import type { Env } from "./types";

export const KEY_PASSWORD_HASH = "admin_password_hash";
export const KEY_SESSION_EPOCH = "session_epoch";
export const KEY_RUNS_RETENTION = "runs_retention_days";
/** 运行记录保留期默认值（天），与调度器/清理接口的兜底一致 */
export const DEFAULT_RUN_RETENTION_DAYS = 90;

/** 读取单个配置；无缓存（调用频率低：改密/改保留期/每 5 分钟的调度清理）。 */
export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key=?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

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
