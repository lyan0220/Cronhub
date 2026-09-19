export type Account = {
  id: number;
  name: string;
  github_login: string | null;
  token_fingerprint: string;
  status: string;
  last_verified_at: number | null;
};

/** 通知渠道（Webhook 目标），在「账户 → 通知设置」里管理 */
export type Channel = {
  id: number;
  name: string;
  type: "wecom" | "feishu" | "telegram" | "bark" | "generic";
  url: string;
};

/** 渠道类型的中文标签（表单多选列表与渠道管理共用） */
export const CHANNEL_TYPE_LABEL: Record<Channel["type"], string> = {
  wecom: "企业微信",
  feishu: "飞书",
  telegram: "Telegram",
  bark: "Bark",
  generic: "通用 JSON",
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
  /** 失败告警推送开关：1 = 推送，0 = 静默 */
  notify: number;
  /** 失败通知渠道 id 的 JSON 数组；null = 全部渠道（仅 notify=1 时有意义） */
  notify_channel_ids: string | null;
  /** 定时调度连续失败次数；> 0 且停用即为「已自动暂停」 */
  fail_streak: number;
  /** cron 计算时区（IANA 名称）；null/空 = UTC */
  timezone: string | null;
};

export type Run = {
  id: number;
  job_id: number;
  job_name?: string | null;
  triggered_at: number;
  source: "schedule" | "manual" | "monitor";
  status: "success" | "failed";
  http_status: number | null;
  error_message: string | null;
  /** workflow 真实结果追踪（runtrack 轮询回填；触发失败的行恒为 null） */
  gh_state: "waiting" | "running" | "done" | "unknown" | null;
  gh_conclusion: string | null;
  gh_run_url: string | null;
  gh_run_id: number | null;
  gh_completed_at: number | null;
};

/** 运行记录来源标签（定时 / 手动 / 监控联动触发） */
export const SOURCE_LABEL: Record<Run["source"], string> = {
  schedule: "定时",
  manual: "手动",
  monitor: "联动",
};

export type Monitor = {
  id: number;
  name: string;
  url: string;
  method: "GET" | "HEAD";
  /** 0 = 任意 2xx 即成功；其余为精确状态码 */
  expected_status: number;
  keyword: string | null;
  headers_json: string | null;
  timeout_ms: number;
  interval_seconds: number;
  enabled: number;
  notify: number;
  notify_channel_ids: string | null;
  fail_threshold: number;
  on_down_job_id: number | null;
  on_up_job_id: number | null;
  on_down_job_name: string | null;
  on_up_job_name: string | null;
  /** 调度器维护的运行状态 */
  status: "pending" | "up" | "down";
  fail_streak: number;
  last_latency_ms: number | null;
  next_run_at: number;
  last_run_at: number | null;
  /** 列表接口聚合出的最近一次心跳（无心跳为 null） */
  last_status: "up" | "down" | null;
  last_heartbeat_at: number | null;
  hb_24h_total: number;
  hb_7d_total: number;
  avg_latency_24h: number | null;
  /** 在线率（0-100 整数）；窗口内无数据为 null */
  uptime_24h: number | null;
  uptime_7d: number | null;
  created_at: number;
  updated_at: number;
};

export type Heartbeat = {
  id: number;
  monitor_id: number;
  created_at: number;
  status: "up" | "down";
  http_status: number | null;
  latency_ms: number | null;
  error_message: string | null;
};

export type MonitorStats = {
  uptime_24h: number | null;
  uptime_7d: number | null;
  uptime_30d: number | null;
  hb_24h_total: number;
  avg_latency_24h: number | null;
  max_latency_24h: number | null;
};

/** 手动探测接口的返回（probeAndRecord 的 outcome） */
export type ProbeOutcome = {
  result: {
    status: "up" | "down";
    http_status: number | null;
    latency_ms: number;
    error: string | null;
  };
  downTransition: boolean;
  upTransition: boolean;
  failStreak: number;
  linkJobName: string | null;
  linkError: string | null;
};

export type Stats = {
  accounts: number;
  total_jobs: number;
  enabled_jobs: number;
  total_monitors: number;
  /** 启用中且当前判定为 down 的监控数 */
  down_monitors: number;
  today_runs: number;
  failed_24h: number;
  /** 近 24h workflow 真实失败数（触发成功但 conclusion ≠ success） */
  gh_failed_24h: number;
  /** 近 7 天 workflow 成功率（0-100 整数）；暂无已有结论的 run 为 null */
  success_rate_7d: number | null;
  /** 调度器最近一轮活动时间；从未运行过为 null */
  scheduler_last_run_at: number | null;
};
