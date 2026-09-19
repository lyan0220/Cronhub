# GitHub Actions 定时触发中心

部署在 Cloudflare Workers + D1 上的定时任务服务：配置 GitHub 账号与任务规则，按计划自动触发目标仓库的 GitHub Actions workflow。

## 功能

- **多账号管理**：管理多个 GitHub 账号的 PAT，使用 AES-GCM 加密存储，并支持在线验证
- **定时任务**：每个任务独立调度，支持 cron 表达式（可按任意 IANA 时区）、固定间隔和随机间隔三种规则，可随时启停
- **两种触发方式**：支持 `workflow_dispatch`（可指定分支并传入 inputs）和 `repository_dispatch`（通过 `client_payload` 传参），workflow 支持从列表中选择
- **运行记录**：记录每次触发的时间、状态、HTTP 状态码和错误信息，支持手动立即触发，保留期可配置
- **workflow 结果追踪**：自动轮询 GitHub Runs API，回填 workflow 的真实执行结论（成功、失败、取消等）；触发成功不等于执行成功，两类失败分别告警和统计
- **失败告警与自动停用**：支持企业微信、飞书、Telegram、Bark 和通用 JSON 等通知渠道；任务可自选推送路径，触发失败与 workflow 执行失败均可推送，连续失败后自动停用
- **心跳监控**：对任意 HTTP(S) 地址周期性探测——默认浏览器 UA、可自定义请求头，模拟真实访问；支持期望状态码与响应体关键词断言、心跳条带与多窗口在线率展示；宕机 / 恢复推送告警，并可**联动触发任务**（如宕机自动重启的恢复脚本）
- **Web 管理页**：单密码登录，支持在页面内修改密码，账号 / 任务 / 运行记录统一管理，仪表盘展示调度器心跳

## 部署

### GitHub Actions 部署（推荐）

1. 将本仓库 Fork 到你的 GitHub 账号。
2. 仓库 Settings → Secrets and variables → Actions，添加 3 个 secret：

| Secret | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare My Profile → API Tokens → Create Token，使用 Edit Cloudflare Workers 模板（含 Workers Scripts:Edit、D1:Edit） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard 首页右侧 Account ID |
| `ADMIN_PASSWORD` | 初始登录密码（仅在从未于页面内改密时生效，见下） |

3. 打开 Actions → `Deploy`，点击 `Run workflow`，选择 `main` 分支后再次点击 `Run workflow`。工作流完成后即可访问管理页面。

之后可以：

- 向 `main` 分支推送代码，自动部署；纯 Markdown 文档变更不会触发部署。
- 在 Actions → `Deploy` → `Run workflow` 中手动部署。

首次部署会自动创建 D1 数据库（`cronjob_db`）、初始化表结构并生成 `TOKEN_ENC_KEY`。

注意：

- `TOKEN_ENC_KEY` 只在首次部署时生成。删除后，已保存的 PAT 将无法解密。

修改密码：

- 登录后打开账户菜单 →「修改密码」。修改成功后需要重新登录。
- 页面内修改的密码优先于 `ADMIN_PASSWORD`。忘记密码时，删除数据库中的密码哈希即可恢复使用 `ADMIN_PASSWORD`：

  ```bash
  npx wrangler d1 execute cronjob_db --remote --command "DELETE FROM settings WHERE key='admin_password_hash'"
  ```

  如果 `ADMIN_PASSWORD` 也已忘记，请先更新该 secret 并重新部署。

### 方式二：本地部署

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put TOKEN_ENC_KEY   # openssl rand -hex 32
npm run db:init
npm run deploy
```

## 使用说明

1. 使用 `ADMIN_PASSWORD` 登录管理页。
2. 在「账号」页添加 GitHub 账号和 PAT，并验证连通性。
3. 在「任务」页选择账号、填写仓库，配置触发方式和调度规则。
4. 在任务列表中启停、立即触发、编辑或删除任务。
5. 在「运行记录」页查看触发详情。

### PAT 权限要求

| 类型 | 权限 |
|---|---|
| classic | `repo` scope |
| fine-grained | Repository permissions 中 **Actions** 与 **Contents** 均设 **Read and write** |

### 触发方式：workflow_dispatch

适合需要指定分支或传入参数的 workflow。在目标仓库的 workflow 文件中添加：

```yaml
on: workflow_dispatch
```

需要传参时才声明 inputs：

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        required: false
        default: dev
```

后台任务字段：

| 字段 | 值 | 示例 |
|---|---|---|
| 仓库 | owner/repo | `user/repo` |
| workflow 文件名 | 文件名或路径 | `build.yml` |
| 分支 ref | 运行分支 | `main` |
| inputs JSON | 可选；键值与 workflow 的 `inputs` 对应 | `{"environment": "prod"}` |

workflow 内读取入参：`github.event.inputs.environment`。

### 触发方式：repository_dispatch

适合通过事件类型和 JSON 参数触发。在目标仓库的 workflow 文件中添加：

```yaml
on:
  repository_dispatch:
    types: [cron-trigger]
```

后台任务字段：

| 字段 | 值 | 示例 |
|---|---|---|
| 仓库 | owner/repo | `user/repo` |
| event_type | 与 workflow 的 `types` 完全一致，大小写敏感 | `cron-trigger` |
| inputs JSON | 可选；任意 JSON 对象，作为 `client_payload` 传入 | `{"foo": "bar"}` |

workflow 内读取参数：`github.event.client_payload.foo`。

### 两种方式对比

| | workflow_dispatch | repository_dispatch |
|---|---|---|
| 运行分支 | 可指定任意分支 | 固定默认分支 |
| 传参 | 可选，`github.event.inputs` | 可选，`github.event.client_payload` |

注意：被触发的 workflow 文件必须存在于目标仓库的默认分支。

### 故障排查

| HTTP 码 | 原因 |
|---|---|
| 404 | 仓库或 workflow 不存在，PAT 无仓库权限 |
| 422 | ref 不存在，workflow 缺少对应触发器声明 |
| 403 | PAT 权限不足 |

### 通知渠道与自动停用

登录后点击顶栏账户菜单 →「通知设置」：

1. **添加通知渠道**：填写名称、选择类型（企业微信群机器人 / 飞书自定义机器人 / Telegram / Bark / 通用 JSON）、粘贴 Webhook 地址。渠道列表里地址**明文可见**，随时可编辑、删除，每个渠道可单独点「测试」验证。
2. **连续失败自动停用阈值**：定时调度连续失败达到该次数后自动停用任务（列表中显示「已自动暂停」徽章）并发送通知；`0` = 不自动停用。

**任务级选择发送路径**：任务表单的「失败通知」默认**关闭**，打开后可**多选**推送目标——全部渠道（含以后新增的）/ 任意勾选若干渠道，不同任务可以发到不同的群或设备的任意组合。

说明：

- 通用 JSON 渠道会 POST `{"event","title","body"}`，`event` 取值 `job_failed` / `job_auto_paused` / `account_invalid` / `test`，适合自建接收端或 n8n 等自动化平台。
- 任务失败推送「失败通知」所选的渠道；PAT 触发 401 失效属于账号级事件，推送到**全部渠道**（按账号去重，一轮只推一条）。
- 连续失败计数只统计**定时调度**的失败；手动触发失败当场可见（toast + 运行记录），不计入。手动启停任务会清零计数。
- 任务失败会推送通知，但任务成功不推送（避免打扰）。删除渠道后，引用它的任务自动停止推送（任务本身不受影响）。

### 通知消息模板

所有事件的文案由 `src/server/notify.ts` 的统一构造器生成，只有一套极简版式：**每条通知一行——`[对象名] [emoji 状态] 原因`**，仅联动触发这类罕见信息才另起一行。状态 emoji：🔴 宕机、✅ 恢复、❌ 失败、⛔ 自动停用、🔑 PAT 失效、🔔 测试。共七种事件：

| 事件 event | 触发时机 | 消息（单行） |
|---|---|---|
| `job_failed` | 定时触发失败，且尚未达到自动停用阈值 | `[{任务名}] [❌ 触发失败] {错误信息}` |
| `job_auto_paused` | 连续失败达到阈值、任务被自动停用的当轮 | `[{任务名}] [⛔ 已自动停用] {最近错误}` |
| `workflow_failed` | dispatch 成功但 workflow 真实执行结论非 success（runtrack 轮询回填） | `[{任务名}] [❌ 执行失败] {conclusion}`，run 链接另起一行 |
| `account_invalid` | 某账号的 PAT 触发 GitHub 401（按账号去重） | `[{账号名}] [🔑 PAT 已失效] 请到「账号」页更新令牌` |
| `monitor_down` | 监控连续失败达到阈值、判定宕机的当轮 | `[{监控名}] [🔴 宕机] {错误信息}`，联动时追加 `已联动触发「{任务名}」` |
| `monitor_up` | 宕机中的监控探测恢复 | `[{监控名}] [✅ 恢复] HTTP {状态码} · {ms}ms`，联动时追加同上 |
| `test` | 渠道列表里点「测试」 | `[{渠道名}] [🔔 连通正常]` |

监控联动触发失败复用 `job_failed` 事件，消息为 `[{监控名}] [❌ 联动触发失败] {错误原因}`。

一条 `monitor_down` 的完整观感：

```text
[内网管理后台] [🔴 宕机] 探测超时（10s 无响应）
已联动触发「故障自动重启」
```

各渠道的打包格式（文案一致，仅首行渲染有差异）：

| 渠道 | 请求体与渲染效果 |
|---|---|
| 企业微信 | `{"msgtype":"markdown","markdown":{"content":"**标题**\n正文"}}`——群内标题加粗显示 |
| 飞书 | `{"msg_type":"text","content":{"text":"标题\n正文"}}`——text 消息不支持 markdown，保持纯文本 |
| Telegram | `{"text":"<b>标题</b>\n正文","parse_mode":"HTML"}`——标题加粗，正文做 HTML 转义 |
| Bark | `{"title":"标题","body":"正文","group":"Cronhub"}`——推送卡片原生标题/正文两段式 |
| 通用 JSON | `{"event":"…","title":"…","body":"…"}` 原样透传，适合自建端二次加工 |

### 心跳监控与任务联动

侧边栏「监控」页提供 HTTP 心跳探测：

- **探测方式**：按配置的间隔向目标 URL 发起 GET/HEAD 请求。默认携带浏览器 User-Agent 与 Accept 头（模拟真实访问），可在表单里用 JSON 自定义请求头覆盖或追加。
- **判定规则**：期望状态码（默认任意 2xx，也可精确指定）+ 可选的响应体关键词包含检查（仅 GET；读取上限 1MB）。网络错误、超时、状态码不符、关键词缺失均判失败。
- **防抖与状态机**：连续失败达到「失败阈值」（默认 1 次）才判定宕机（down），成功即恢复（up）并清零计数；仅在状态切换的当轮推送 `monitor_down` / `monitor_up` 通知，不随每次失败重复发送。
- **任务联动**：可为每个监控配置「宕机时触发」/「恢复时触发」的任务（如自动重启、故障切换的 workflow）。联动在状态切换时触发一次，像手动触发一样记录运行并追踪执行结果；联动触发失败会追加一条 `job_failed` 告警。联动任务不受自身启用状态限制（可以专门建一个只留给联动用的任务）。删除任务后，监控上的联动引用自动置空。
- **粒度与保留期**：平台 Cron 每 2 分钟唤醒一次，探测间隔最小 2 分钟；心跳记录默认保留 30 天（`heartbeats_retention_days`，可在 settings 表调整）。手动「立即检测」记录心跳并可立即恢复 up，但不参与宕机判定。
- **页面管理**：监控页支持卡片 / 列表两种视图（偏好自动记住）；详情抽屉可一键清空某监控的全部心跳记录（在线率统计随之从零重算）。

### 其他

- cron 默认按 UTC 计算；可在任务表单中为每个任务选择生效时区（IANA 名称，如 `Asia/Shanghai`），系统会按该时区的墙上时间判定触发时刻。
- 调度相关时间（表单预览、任务的「下次运行」）按任务生效时区显示——UTC 任务直接显示 UTC 时刻，不再换算为本机时间；间隔任务与时区无关，按浏览器本地时区显示。运行记录页始终按本地时区显示。
- 调度器每 2 分钟扫描一次；Cloudflare 免费计划的 cron 触发延迟约 1 分钟。
- 漏跑补发：服务停摆期间错过的任务只补发一次（下一轮唤醒时），之后恢复正常节奏，不会逐轮追赶积压任务。

## 技术栈

Hono · React 18 · Vite · Tailwind CSS v4 · Cloudflare Workers · D1 · Vitest

## 许可证

[MIT](LICENSE)
