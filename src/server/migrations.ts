// D1 轻量迁移：schema.sql 只负责新建库（CREATE TABLE IF NOT EXISTS 全量建表），
// 已有库的结构变更走这里的有序迁移列表，fetch 与 scheduled 入口各自先调
// ensureMigrated。isolate 内缓存检查结果，冷启动只多一条 SELECT。
import type { Env } from "./types";

type Migration = { id: number; name: string; statements: string[] };

// 迁移一旦发布不可修改：只允许在数组末尾追加新条目（id 递增）。
// 注意 ADD COLUMN 类语句对「用新版 schema.sql 新建的库」会报 duplicate
// column，execMigration 会按已生效处理（见该函数内注释）。
const MIGRATIONS: Migration[] = [
  {
    // 覆盖旧方案 1+2 两条迁移的合并版（发布前收敛为一条，避免无意义的版本分层）。
    // 若本地开发库在会话期间应用过中间版本（schema_migrations 里有旧 id 记录），
    // 直接重置本地库（删 .wrangler/state 后 npm run db:local），不要为此追加新迁移。
    id: 1,
    name: "notify-fail-streak-timezone-channels",
    statements: [
      // 任务级失败通知开关（默认关闭）与连续失败计数（自动停用依据）
      "ALTER TABLE jobs ADD COLUMN notify INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE jobs ADD COLUMN fail_streak INTEGER NOT NULL DEFAULT 0",
      // cron 计算时区（NULL=UTC）与失败通知渠道多选（JSON 数组，NULL=全部渠道）
      "ALTER TABLE jobs ADD COLUMN timezone TEXT",
      "ALTER TABLE jobs ADD COLUMN notify_channel_ids TEXT",
      // 通知渠道表：任务失败等事件推送的 Webhook 目标，可配置多个
      `CREATE TABLE IF NOT EXISTS notify_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      // 旧的单一 notify_config 自动迁移成「默认渠道」，阈值拆到独立设置键
      `INSERT INTO settings (key, value)
       SELECT 'notify_auto_pause_threshold', COALESCE(json_extract(value, '$.auto_pause_threshold'), '0')
       FROM settings WHERE key = 'notify_config'`,
      `INSERT INTO notify_channels (name, type, url, created_at, updated_at)
       SELECT '默认渠道', json_extract(value, '$.type'), json_extract(value, '$.url'),
              strftime('%s','now') * 1000, strftime('%s','now') * 1000
       FROM settings WHERE key = 'notify_config' AND json_extract(value, '$.url') IS NOT NULL`,
      "DELETE FROM settings WHERE key = 'notify_config'",
    ],
  },
];

let migrated = false;

export function _resetMigrated(): void {
  migrated = false;
}

export async function ensureMigrated(env: Env): Promise<void> {
  if (migrated) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)",
  ).run();
  const applied = await env.DB.prepare("SELECT id FROM schema_migrations").all<{ id: number }>();
  const appliedIds = new Set((applied.results ?? []).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (appliedIds.has(m.id)) continue;
    await execMigration(env, m);
  }
  migrated = true;
}

async function execMigration(env: Env, m: Migration): Promise<void> {
  // 不用 batch 做整段事务：多 isolate 并发冷启动时，后到的一方会撞上
  // duplicate column，batch 会整体失败重试再失败。逐条执行并容忍
  // 「列已存在」类错误（新库经 schema.sql 建表后同样触发），迁移行用
  // INSERT OR IGNORE 防并发重复写入。
  for (const sql of m.statements) {
    try {
      await env.DB.prepare(sql).run();
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (!/duplicate column|already exists/i.test(msg)) throw e;
    }
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?,?,?)",
  )
    .bind(m.id, m.name, Date.now())
    .run();
}
