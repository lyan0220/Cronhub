// 失败告警 webhook：把任务失败 / 自动停用 / PAT 失效推送到外部渠道。
// 告警是尽力而为——超时单次尝试、任何失败静默返回 false，绝不允许告警
// 故障反过来拖垮或打断调度循环本身。
import type { Env } from "./types";

export type NotifyType = "wecom" | "feishu" | "telegram" | "bark" | "generic";

const TYPES: NotifyType[] = ["wecom", "feishu", "telegram", "bark", "generic"];

export function isNotifyType(v: unknown): v is NotifyType {
  return typeof v === "string" && (TYPES as string[]).includes(v);
}

export type ChannelRow = {
  id: number;
  name: string;
  type: NotifyType;
  url: string;
  created_at: number;
  updated_at: number;
};

export async function getChannels(env: Env): Promise<ChannelRow[]> {
  const rows = await env.DB.prepare("SELECT * FROM notify_channels ORDER BY id").all<ChannelRow>();
  return rows.results ?? [];
}

export async function getChannel(env: Env, id: number): Promise<ChannelRow | null> {
  const row = await env.DB.prepare("SELECT * FROM notify_channels WHERE id=?").bind(id).first<ChannelRow>();
  return row ?? null;
}

export type NotifyPayload = {
  event: "job_failed" | "job_auto_paused" | "account_invalid" | "test";
  title: string;
  body: string;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

/** 渠道适配：统一转成各平台 webhook 的请求体。 */
export function buildNotifyRequest(cfg: { type: NotifyType; url: string }, p: NotifyPayload): { url: string; headers: Record<string, string>; body: string } {
  const text = `${p.title}\n${p.body}`;
  switch (cfg.type) {
    case "wecom": // 企业微信群机器人
      return { url: cfg.url, headers: JSON_HEADERS, body: JSON.stringify({ msgtype: "text", text: { content: text } }) };
    case "feishu": // 飞书自定义机器人
      return { url: cfg.url, headers: JSON_HEADERS, body: JSON.stringify({ msg_type: "text", content: { text } }) };
    case "telegram":
      // URL 自带 chat_id：https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>
      return { url: cfg.url, headers: JSON_HEADERS, body: JSON.stringify({ text }) };
    case "bark": // Bark（iOS 推送），url 形如 https://api.day.app/<deviceKey>
      return { url: cfg.url, headers: JSON_HEADERS, body: JSON.stringify({ title: p.title, body: p.body, group: "Cronhub" }) };
    case "generic": // 通用 JSON POST，原文透传全部字段
      return { url: cfg.url, headers: JSON_HEADERS, body: JSON.stringify(p) };
  }
}

export async function sendNotify(
  cfg: { type: NotifyType; url: string },
  payload: NotifyPayload,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<boolean> {
  const req = buildNotifyRequest(cfg, payload);
  try {
    const res = await fetchFn(req.url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
