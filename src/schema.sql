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
