import { useEffect, useState } from "react";
import { del, errText, get, post, put } from "../api";
import { useToast } from "./Toast";
import { CHANNEL_TYPE_LABEL, type Channel } from "../types";
import { Badge, Button, Dialog, Field, Input, Select, Skeleton, useConfirm } from "../ui";
import { Pencil, Plus, Trash2 } from "../ui/icons";

type ChannelType = Channel["type"];

type ChannelView = { id: number; name: string; type: ChannelType; url: string };

/** 各渠道的 Webhook URL 格式提示（value 与后端 NotifyType 一致） */
const CHANNEL_TYPES: { value: ChannelType; hint: string; placeholder: string }[] = [
  {
    value: "wecom", placeholder: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…",
    hint: "企业微信群机器人地址。群设置 → 群机器人 → 添加 → 复制 Webhook 地址。",
  },
  {
    value: "feishu", placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/…",
    hint: "飞书自定义机器人地址。群设置 → 群机器人 → 自定义机器人 → 复制 Webhook 地址。",
  },
  {
    value: "telegram", placeholder: "https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>",
    hint: "用 @BotFather 创建机器人后，把完整 sendMessage 地址（含 bot token 与 chat_id）粘贴到这里。",
  },
  {
    value: "bark", placeholder: "https://api.day.app/<你的Key>",
    hint: "iOS 应用 Bark 的设备推送地址，在 App 内复制。",
  },
  {
    value: "generic", placeholder: "https://example.com/webhook",
    hint: "向该地址 POST JSON：{ event, title, body }，适合自建接收端或 n8n 等自动化平台。",
  },
];

const TYPE_LABEL = CHANNEL_TYPE_LABEL;

/** 消息样例：与 monitor_down 事件的实际推送文案一致（纯文本渠道的最终观感） */
const SAMPLE_NOTIFY = [
  "[内网管理后台] [🔴 离线] 探测超时（10s 无响应）",
  "已联动触发「故障自动重启」",
].join("\n");

/**
 * 通知渠道管理：渠道列表（地址明文可见、随时编辑）+ 单渠道测试 + 全局自动停用阈值。
 * 任务在表单里选择「失败通知」发到哪个渠道。
 */
export default function NotifyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [channels, setChannels] = useState<ChannelView[] | null>(null);
  const [threshold, setThreshold] = useState(0);
  const [thresholdDraft, setThresholdDraft] = useState(0);
  const [savingThreshold, setSavingThreshold] = useState(false);
  /** null = 列表视图；"new" = 新增；数字 = 编辑对应渠道 */
  const [editing, setEditing] = useState<ChannelView | "new" | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("wecom");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErr, setFieldErr] = useState<{ name?: string; url?: string }>({});

  async function load() {
    try {
      const [chs, cfg] = await Promise.all([
        get<{ channels: ChannelView[] }>("/api/notify/channels"),
        get<{ auto_pause_threshold: number }>("/api/notify/config"),
      ]);
      setChannels(chs.channels);
      setThreshold(cfg.auto_pause_threshold);
      setThresholdDraft(cfg.auto_pause_threshold);
    } catch (e) {
      toast(errText(e), "err");
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  function close() {
    onClose();
    setEditing(null);
    setName(""); setType("wecom"); setUrl("");
    setFieldErr({}); setBusy(false);
  }

  function openNew() {
    setEditing("new");
    setName(""); setType("wecom"); setUrl("");
    setFieldErr({});
  }

  function openEdit(ch: ChannelView) {
    setEditing(ch);
    setName(ch.name); setType(ch.type); setUrl(ch.url); // 地址明文预填，可直接改
    setFieldErr({});
  }

  async function saveChannel() {
    const errs: typeof fieldErr = {};
    if (!name.trim()) errs.name = "渠道名称不能为空";
    if (!/^https:\/\//.test(url.trim())) errs.url = "请粘贴 https:// 开头的完整 Webhook 地址";
    setFieldErr(errs);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    try {
      if (editing === "new") {
        await post("/api/notify/channels", { name: name.trim(), type, url: url.trim() });
        toast("渠道已添加");
      } else if (editing !== null) {
        await put(`/api/notify/channels/${editing.id}`, { name: name.trim(), type, url: url.trim() });
        toast("渠道已更新");
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast(errText(e), "err");
    } finally {
      setBusy(false);
    }
  }

  async function testChannel(ch: ChannelView) {
    setBusy(true);
    try {
      await post(`/api/notify/channels/${ch.id}/test`);
      toast(`测试消息已发送到「${ch.name}」，请到对应渠道查收`);
    } catch (e) {
      toast(errText(e), "err");
    } finally {
      setBusy(false);
    }
  }

  async function removeChannel(ch: ChannelView) {
    const ok = await confirm({
      title: `删除渠道「${ch.name}」？`,
      description: "正在使用该渠道的任务将不再收到推送（任务仍正常调度）。",
      confirmText: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await del(`/api/notify/channels/${ch.id}`);
      toast("渠道已删除");
      await load();
    } catch (e) {
      toast(errText(e), "err");
    }
  }

  async function saveThreshold() {
    const t = Number(thresholdDraft);
    if (!Number.isInteger(t) || t < 0 || t > 100) {
      toast("阈值必须是 0-100 的整数（0 = 不自动停用）", "err");
      return;
    }
    setSavingThreshold(true);
    try {
      await put("/api/notify/config", { auto_pause_threshold: t });
      setThreshold(t);
      toast("自动停用阈值已保存");
    } catch (e) {
      toast(errText(e), "err");
    } finally {
      setSavingThreshold(false);
    }
  }

  const activeHint = CHANNEL_TYPES.find((t) => t.value === type);

  return (
    <Dialog open={open} onClose={close} title="通知设置" width="max-w-lg"
      footer={editing === null ? (
        <Button variant="secondary" onClick={close}>关闭</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={() => setEditing(null)}>取消</Button>
          <Button variant="primary" loading={busy} onClick={() => void saveChannel()}>
            {editing === "new" ? "添加" : "保存修改"}
          </Button>
        </>
      )}>
      {editing === null ? (
        <div className="space-y-6">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">通知渠道</h3>
              <Button size="sm" variant="secondary" onClick={openNew} icon={<Plus className="size-3.5" />}>添加</Button>
            </div>
            {channels === null ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-14 w-full rounded-lg" />
                <Skeleton className="h-14 w-full rounded-lg" />
              </div>
            ) : channels.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-fg-subtle">
                还没有渠道，点右上角「添加」创建第一个
              </p>
            ) : (
              /* 渠道列表：名称 + 类型 + 完整地址（可复制核对），行内测试/编辑/删除 */
              <div className="divide-y divide-border/60 rounded-lg border border-border">
                {channels.map(ch => (
                  <div key={ch.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-fg">{ch.name}</span>
                        <Badge>{TYPE_LABEL[ch.type]}</Badge>
                      </div>
                      {/* 地址明文展示：单管理员系统，方便核对与二次编辑 */}
                      <p className="mt-0.5 truncate font-mono text-xs text-fg-subtle" title={ch.url}>{ch.url}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void testChannel(ch)}>测试</Button>
                      <button type="button" aria-label={`编辑「${ch.name}」`} title="编辑"
                        className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-panel-hover hover:text-fg"
                        onClick={() => openEdit(ch)}>
                        <Pencil className="size-4" aria-hidden />
                      </button>
                      <button type="button" aria-label={`删除「${ch.name}」`} title="删除"
                        className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-danger-soft hover:text-danger"
                        onClick={() => void removeChannel(ch)}>
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">自动停用</h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-fg">同一任务连续失败</span>
              <div className="w-16">
                <Input aria-label="连续失败次数" type="number" min={0} max={100}
                  value={thresholdDraft}
                  onChange={e => setThresholdDraft(Number(e.target.value))} />
              </div>
              <span className="text-sm text-fg">次后自动停用并发送通知</span>
              <Button size="sm" variant="secondary" loading={savingThreshold} onClick={() => void saveThreshold()}
                disabled={thresholdDraft === threshold}>保存</Button>
            </div>
            <p className="mt-1.5 text-xs text-fg-subtle">
              仅统计定时触发的失败，成功即清零重新计数；设为 0 表示不自动停用。
            </p>
          </section>

          <details className="rounded-lg border border-border px-3 py-2.5">
            <summary className="cursor-pointer text-xs font-medium text-fg-muted">消息格式预览</summary>
            <pre className="mt-2 overflow-x-auto rounded-md bg-surface px-3 py-2 font-mono text-xs whitespace-pre-wrap text-fg-muted">{SAMPLE_NOTIFY}</pre>
            <p className="mt-2 text-xs text-fg-subtle">
              每条通知一行：「[对象名] [状态] 原因」，状态带 emoji（🔴 离线、✅ 恢复、❌ 失败、⛔ 自动停用、🔑 PAT
              失效、🔔 测试）；仅联动触发这类罕见信息才另起一行。企业微信与 Telegram 渠道首行加粗；飞书 / Bark /
              通用 JSON 为上述纯文本。
            </p>
          </details>
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); void saveChannel(); }} noValidate>
          <Field label="渠道名称" error={fieldErr.name ?? null}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} invalid={!!fieldErr.name}
                value={name} placeholder="如 运维企微群"
                onChange={e => setName(e.target.value)} />
            )}
          </Field>
          <Field label="渠道类型">
            {({ id }) => (
              <Select id={id} value={type} onChange={e => setType(e.target.value as ChannelType)}>
                {CHANNEL_TYPES.map(t => <option key={t.value} value={t.value}>{CHANNEL_TYPE_LABEL[t.value]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Webhook 地址" hint={activeHint?.hint} error={fieldErr.url ?? null}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} invalid={!!fieldErr.url}
                value={url} placeholder={activeHint?.placeholder} className="font-mono text-xs"
                onChange={e => setUrl(e.target.value)} />
            )}
          </Field>
          {typeof editing === "object" && (
            <button type="button" disabled={busy}
              className="text-xs text-fg-muted underline-offset-2 hover:underline"
              onClick={() => { setEditing(null); void testChannel(editing); }}>
              不做修改，先发送测试
            </button>
          )}
        </form>
      )}
    </Dialog>
  );
}
