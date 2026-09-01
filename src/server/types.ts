/** Workers Ratelimit binding（wrangler.jsonc ratelimits）。测试环境可不注入。 */
type RateLimiterBinding = {
  limit(key: { key: string }): Promise<{ success: boolean }>;
};

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  TOKEN_ENC_KEY: string;
  RATE_LIMITER?: RateLimiterBinding;
};

export type AccountRow = {
  id: number;
  name: string;
  github_login: string | null;
  token_encrypted: string;
  token_fingerprint: string;
  status: string;
  last_verified_at: number | null;
  created_at: number;
  updated_at: number;
};

export type JobRow = {
  id: number;
  name: string;
  account_id: number;
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
  created_at: number;
  updated_at: number;
};
