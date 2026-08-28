export type Account = {
  id: number;
  name: string;
  github_login: string | null;
  token_fingerprint: string;
  status: string;
  last_verified_at: number | null;
};

export type Schedule = {
  type: "cron" | "interval";
  expr?: string;
  mode?: "fixed" | "random";
  value?: number;
  min?: number;
  max?: number;
  unit?: "m" | "h" | "d";
};

export type Job = {
  id: number;
  name: string;
  account_id: number;
  account_name: string | null;
  repo: string;
  trigger_type: "workflow_dispatch" | "repository_dispatch";
  workflow_id: string | null;
  event_type: string | null;
  ref: string | null;
  inputs_json: string | null;
  schedule_json: string;
  enabled: number;
  next_run_at: number;
  last_run_at: number | null;
};

export type Run = {
  id: number;
  job_id: number;
  job_name?: string | null;
  triggered_at: number;
  source: "schedule" | "manual";
  status: "success" | "failed";
  http_status: number | null;
  error_message: string | null;
};

export type Stats = {
  accounts: number;
  total_jobs: number;
  enabled_jobs: number;
  today_runs: number;
  failed_24h: number;
};
