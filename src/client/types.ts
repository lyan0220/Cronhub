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
  /** 调度器最近一轮活动时间；从未运行过为 null */
  scheduler_last_run_at: number | null;
};
