CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  github_login TEXT,
  token_encrypted TEXT NOT NULL,
  token_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  repo TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('workflow_dispatch','repository_dispatch')),
  workflow_id TEXT,
  event_type TEXT,
  ref TEXT,
  inputs_json TEXT,
  schedule_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  -- 失败通知开关（默认 0=关闭）；连续失败计数（自动停用依据）；cron 计算时区
  -- （NULL=UTC）；失败通知渠道 JSON 数组（NULL = 全部渠道，仅 notify=1 时有意义）
  notify INTEGER NOT NULL DEFAULT 0,
  fail_streak INTEGER NOT NULL DEFAULT 0,
  timezone TEXT,
  notify_channel_ids TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  triggered_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id, triggered_at DESC);
-- 单列时间索引：不带 job_id 的运行记录列表（ORDER BY triggered_at DESC）和
-- 调度器每 5 分钟一次的 90 天清理（DELETE WHERE triggered_at < ?）都走这里，
-- 没有它就是全表扫描 + 排序，数据量上去后拖慢每次 Cron 唤醒。
CREATE INDEX IF NOT EXISTS idx_runs_time ON runs(triggered_at);

-- 键值配置。目前存管理员密码的 PBKDF2 哈希（admin_password_hash）、会话纪元
-- （session_epoch，改密 +1 使旧会话全部失效）、运行记录保留期
-- （runs_retention_days）、连续失败自动停用阈值（notify_auto_pause_threshold）
-- 与调度器心跳（scheduler_last_run_at）。环境变量 ADMIN_PASSWORD 只在
-- 没有密码哈希时兜底。
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 通知渠道：任务失败等事件推送的 Webhook 目标，可配置多个，
-- 任务级通过 jobs.notify_channel_ids 选择（NULL = 全部渠道）。
CREATE TABLE IF NOT EXISTS notify_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 结构迁移记录：老库升级走 src/server/migrations.ts 的迁移列表，新库由上面
-- 的全量建表直接到位（迁移执行时按 duplicate column 容错跳过）。
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
