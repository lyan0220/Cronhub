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
  /** 失败告警开关：1 = 推送 webhook，0 = 静默 */
  notify: number;
  /** 失败通知发送渠道 id 的 JSON 数组；NULL = 全部渠道（仅 notify=1 时有意义） */
  notify_channel_ids: string | null;
  /** 定时调度连续失败计数；成功清零；手动启停时重置 */
  fail_streak: number;
  /** cron 计算时区（IANA 名称）；null = UTC */
  timezone: string | null;
  created_at: number;
  updated_at: number;
};

export type MonitorRow = {
  id: number;
  name: string;
  url: string;
  method: "GET" | "HEAD";
  /** 期望状态码：逗号分隔的单码或区间字符串（"200" / "200,204" / "200-299"）；旧行为数字（0 = 任意 2xx） */
  expected_status: number | string;
  /** 响应体包含判定子串；NULL = 不检查（仅 GET 有意义） */
  keyword: string | null;
  /** 自定义请求头 JSON 对象；NULL = 仅默认头 */
  headers_json: string | null;
  timeout_ms: number;
  interval_seconds: number;
  enabled: number;
  /** 状态变化推送开关：1 = 推送，0 = 静默 */
  notify: number;
  /** 状态变化通知渠道 id 的 JSON 数组；NULL = 全部渠道（仅 notify=1 时有意义） */
  notify_channel_ids: string | null;
  /** 连续失败 N 次才判 down（防抖） */
  fail_threshold: number;
  /** down / up 状态转换时联动触发的任务；NULL = 不联动 */
  on_down_job_id: number | null;
  on_up_job_id: number | null;
  /** 运行状态（调度器维护）：pending=尚未探测 / up / down */
  status: "pending" | "up" | "down";
  /** 连续失败计数；成功清零；手动启停时重置 */
  fail_streak: number;
  last_latency_ms: number | null;
  next_run_at: number;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
};

export type HeartbeatRow = {
  id: number;
  monitor_id: number;
  created_at: number;
  status: "up" | "down";
  http_status: number | null;
  latency_ms: number | null;
  error_message: string | null;
};
