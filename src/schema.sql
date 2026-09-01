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

-- 键值配置。目前存管理员密码的 PBKDF2 哈希（admin_password_hash）与会话纪元
-- （session_epoch，改密 +1 使旧会话全部失效）。环境变量 ADMIN_PASSWORD 只在
-- 没有这行配置时作为初始密码兜底。
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
