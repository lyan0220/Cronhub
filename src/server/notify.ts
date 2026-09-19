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
  event:
    | "job_failed"
    | "job_auto_paused"
    | "account_invalid"
    | "workflow_failed"
    | "monitor_down"
    | "monitor_up"
    | "test";
  title: string;
  body: string;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Telegram parse_mode=HTML 下的正文转义：错误信息常含 URL 与尖括号 */
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 渠道适配：统一转成各平台 webhook 的请求体。第一行（标题）加粗、正文原样，
 * 正文为空时输出单行消息。emoji 状态嵌在方括号里，五种渠道观感一致。 */
export function buildNotifyRequest(cfg: { type: NotifyType; url: string }, p: NotifyPayload): { url: string; headers: Record<string, string>; body: string } {
  const text = p.body ? `${p.title}\n${p.body}` : p.title;
  switch (cfg.type) {
    case "wecom": // 企业微信群机器人：支持 markdown，首行加粗即可，正文保持简洁换行
      return { url: cfg.url, headers: JSON_HEADERS, body: JSON.stringify({ msgtype: "markdown", markdown: { content: p.body ? `**${p.title}**\n${p.body}` : `**${p.title}**` } }) };
    case "feishu": // 飞书自定义机器人：text 消息不渲染 markdown，纯文本单行已足够清晰
      return { url: cfg.url, headers: JSON_HEADERS, body: JSON.stringify({ msg_type: "text", content: { text } }) };
    case "telegram":
      // URL 自带 chat_id：https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>
      return { url: cfg.url, headers: JSON_HEADERS, body: JSON.stringify({ text: p.body ? `<b>${escHtml(p.title)}</b>\n${escHtml(p.body)}` : `<b>${escHtml(p.title)}</b>`, parse_mode: "HTML" }) };
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

// ---- 统一文案构造 ----
// 全部事件的文案只有一个源头，版式刻意极简：每条通知一行——
// 「[对象名] [emoji 状态] 原因」，在通知栏一眼读完；仅联动触发这类罕见
// 附加信息才另起一行。调整版式只改这里与 buildNotifyRequest（渠道打包），
// 调用方永远只传结构化字段。

type NotifyEvent = NotifyPayload["event"];

function compose(event: NotifyEvent, line: string, extra?: string): NotifyPayload {
  return { event, title: line, body: extra ?? "" };
}

export function notifyJobFailed(p: { name: string; error?: string | null }): NotifyPayload {
  return compose("job_failed", `[${p.name}] [❌ 触发失败]${p.error ? ` ${p.error}` : ""}`);
}

export function notifyJobAutoPaused(p: { name: string; error?: string | null }): NotifyPayload {
  return compose("job_auto_paused", `[${p.name}] [⛔ 已自动停用]${p.error ? ` ${p.error}` : ""}`);
}

export function notifyWorkflowFailed(p: { name: string; conclusion: string; runUrl?: string | null }): NotifyPayload {
  return compose("workflow_failed", `[${p.name}] [❌ 执行失败] ${p.conclusion}`, p.runUrl ?? undefined);
}

export function notifyAccountInvalid(p: { name: string }): NotifyPayload {
  return compose("account_invalid", `[${p.name}] [🔑 PAT 已失效] 请到「账号」页更新令牌`);
}

export function notifyMonitorDown(p: { name: string; error?: string | null; linkJobName?: string | null }): NotifyPayload {
  return compose(
    "monitor_down",
    `[${p.name}] [🔴 离线]${p.error ? ` ${p.error}` : ""}`,
    p.linkJobName ? `已联动触发「${p.linkJobName}」` : undefined,
  );
}

export function notifyMonitorUp(p: { name: string; httpStatus?: number | null; latencyMs?: number | null; linkJobName?: string | null }): NotifyPayload {
  const probe = p.httpStatus != null
    ? `HTTP ${p.httpStatus}${p.latencyMs != null ? ` · ${p.latencyMs}ms` : ""}`
    : null;
  return compose(
    "monitor_up",
    `[${p.name}] [✅ 恢复]${probe ? ` ${probe}` : ""}`,
    p.linkJobName ? `已联动触发「${p.linkJobName}」` : undefined,
  );
}

/** 监控联动触发失败：event 复用 job_failed（通用接收端按事件分发），文案独立 */
export function notifyLinkJobFailed(p: { name: string; error?: string | null }): NotifyPayload {
  return compose("job_failed", `[${p.name}] [❌ 联动触发失败]${p.error ? ` ${p.error}` : ""}`);
}

export function notifyTest(p: { channelName: string }): NotifyPayload {
  return compose("test", `[${p.channelName}] [🔔 连通正常]`);
}
