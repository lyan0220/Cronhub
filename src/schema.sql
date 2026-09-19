-- 表结构定义。字段语义、运行约定与索引取舍统一见文件末尾「字段与维护说明」。

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
  error_message TEXT,
  gh_run_id INTEGER,
  gh_state TEXT CHECK (gh_state IN ('waiting','running','done','unknown')),
  gh_conclusion TEXT,
  gh_run_url TEXT,
  gh_completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_gh_pending ON runs(gh_state, triggered_at);
CREATE INDEX IF NOT EXISTS idx_runs_time ON runs(triggered_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notify_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET' CHECK (method IN ('GET','HEAD')),
  expected_status INTEGER NOT NULL DEFAULT 0,
  keyword TEXT,
  headers_json TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  interval_seconds INTEGER NOT NULL DEFAULT 300,
  enabled INTEGER NOT NULL DEFAULT 1,
  notify INTEGER NOT NULL DEFAULT 0,
  notify_channel_ids TEXT,
  fail_threshold INTEGER NOT NULL DEFAULT 1,
  on_down_job_id INTEGER REFERENCES jobs(id),
  on_up_job_id INTEGER REFERENCES jobs(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','up','down')),
  fail_streak INTEGER NOT NULL DEFAULT 0,
  last_latency_ms INTEGER,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monitors_due ON monitors(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER NOT NULL REFERENCES monitors(id),
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('up','down')),
  http_status INTEGER,
  latency_ms INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor ON heartbeats(monitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeats_time ON heartbeats(created_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

-- ============================================================
-- 字段与维护说明
-- ============================================================

-- accounts：GitHub 账号与 PAT。
--   token_encrypted  AES-GCM 加密的 PAT；token_fingerprint  脱敏指纹（****尾 4 位）。
--   status           ok / invalid / unknown；由 PAT 验证与触发 401 时自动标记。

-- jobs：GitHub Actions 定时任务。
--   schedule_json    调度规则 JSON（cron / 固定间隔 / 随机间隔），结构见 src/server/schedule.ts。
--   next_run_at      下次触发时间；调度器以「WHERE next_run_at=旧值」乐观锁认领并推进，防并发实例重复触发。
--   notify           失败通知开关（默认 0=关闭）。
--   notify_channel_ids  通知渠道 id 的 JSON 数组；NULL = 全部渠道（仅 notify=1 时有意义）。
--   fail_streak      定时调度连续失败计数，成功清零；enabled=0 且 >0 即「已自动暂停」。
--   timezone         cron 计算时区（IANA 名称，NULL = UTC）。

-- runs：每次任务触发一条；workflow 真实执行结果由 runtrack 轮询器回填到 gh_* 列。
--   status / http_status / error_message  只描述 dispatch 请求本身（HTTP 204 即 success）。
--   source           schedule（定时）/ manual（手动）/ monitor（监控联动）。
--   gh_run_id        匹配到的 GitHub run id（跨任务唯一绑定，先到先得）。
--   gh_state         waiting（未匹配到 run）→ running → done（有结论）/ unknown（超追踪窗口放弃）。
--   gh_conclusion    GitHub conclusion：success / failure / cancelled / startup_failure / timed_out…
--   gh_run_url       run 页面链接（前端跳转用）；gh_completed_at  workflow 结束时间。

-- settings：键值配置。
--   admin_password_hash             管理员密码的 PBKDF2 哈希；环境变量 ADMIN_PASSWORD 仅在无哈希时兜底。
--   session_epoch                   会话纪元，改密 +1 使旧会话全部失效。
--   runs_retention_days             运行记录保留期（天，默认 90）。
--   heartbeats_retention_days       心跳保留期（天，默认 30）。
--   notify_auto_pause_threshold     连续失败自动停用阈值（0 = 不自动停用）。
--   scheduler_last_run_at           调度器每轮写入，仪表盘据此判断定时链路是否存活。

-- notify_channels：通知渠道（Webhook 目标），可配置多个，供任务失败与监控状态变化推送共用。

-- monitors：HTTP 心跳监控（周期性探测 http(s) 地址，状态变化推送通知并联动触发任务）。
--   expected_status   0 = 任意 2xx 即成功；其余为精确状态码断言。
--   keyword           响应体包含判定（子串匹配），仅 GET 有意义；NULL = 不检查。
--   headers_json      自定义请求头 JSON 对象，合并覆盖默认头（默认浏览器 UA，模拟真实访问）。
--   interval_seconds  最小 120：受平台 Cron 触发粒度（每 2 分钟）限制。
--   notify / notify_channel_ids  状态变化推送开关与渠道多选，约定同 jobs（NULL = 全部渠道）。
--   fail_threshold    连续失败 N 次才判 down（防抖）；状态转换的当轮才触发通知与任务联动。
--   on_down_job_id / on_up_job_id  down / up 状态转换时各触发一次指定任务（自动恢复场景），空 = 不联动。
--   status            pending（尚未探测）/ up / down；与 fail_streak/last_latency_ms/next_run_at/last_run_at
--                     一样由调度器维护，语义同 jobs 同名列。

-- heartbeats：每次探测一条记录；按 settings.heartbeats_retention_days 定时清理。

-- schema_migrations：结构迁移记录。老库升级走 src/server/migrations.ts 的有序迁移列表，
--   新库由上面的全量建表直接到位（迁移执行时按 duplicate column / already exists 容错跳过）。

-- 索引取舍：
--   idx_jobs_due / idx_monitors_due      调度器每轮的到期查询（enabled, next_run_at）。
--   idx_runs_gh_pending                  runtrack 每轮查 waiting/running 待追踪行。
--   idx_runs_job / idx_heartbeats_monitor  按 job/monitor 的倒序分页（详情页与卡片条带）。
--   idx_runs_time / idx_heartbeats_time  不带前缀列的按时间清理（DELETE WHERE 时间列 < ?），
--                                        没有它就是全表扫描 + 排序，数据量上去后拖慢每次 Cron 唤醒。
