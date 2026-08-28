# GitHub Actions 定时触发中心

Cloudflare Worker + D1 实现的多账号、多仓库 GitHub Actions 定时触发中心：
- 多账号 PAT 管理（AES-GCM 加密存储，支持在线验证）
- 任意 cron / 固定间隔 / 随机间隔调度，任务互相独立
- workflow_dispatch 与 repository_dispatch 双触发方式
- 完整触发记录（成功/失败/HTTP 状态/错误信息）与手动触发
- Web 管理页（单管理密码登录）

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入 ADMIN_PASSWORD 与 TOKEN_ENC_KEY（随机长字符串）
npm run db:local                 # 初始化本地 D1
npm run dev                      # http://localhost:5173
```

测试本地 scheduled（需先 `npm run build`）：

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/cdn-cgi/local/scheduled?format=json"   # 返回 {"outcome":"ok",...}
```

> 端点说明：wrangler 4.x 使用 `/cdn-cgi/local/scheduled`；旧版 wrangler（≤3.x）使用 `curl "http://localhost:8787/__scheduled?cron=*"`。

## 分支模型与发布

| 分支 | 职责 |
|---|---|
| `dev` | 开发分支：包含完整代码、测试（`npm test`）、设计文档；push 不部署 |
| `main` | 生产分支：仅保留生产所需文件（无测试与文档）；push 自动部署 |

日常开发在 `dev` 上进行，发布时在 `dev` 分支运行：

```bash
npm run release    # 同步 dev → main（自动剔除非生产文件并提交）
git push origin main   # 触发自动部署
```

## 部署（推荐：GitHub Actions 自动部署）

push 到 `main` 分支即自动部署；首次部署会自动创建 D1 数据库（`cronjob_db`）、建表并生成加密密钥。

只需一次性在 GitHub 仓库 Settings → Secrets and variables → Actions 添加 3 个 secret：

| Secret | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens → Create Token，模板选 "Edit Cloudflare Workers"，确保包含 **Workers Scripts:Edit** 与 **D1:Edit** 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard 首页右侧 Account ID |
| `ADMIN_PASSWORD` | 管理页登录密码（想改密码就改这里再 push） |

配置完成后把 `main` push 到 GitHub 即完成首次部署。之后：

- 代码改动通过 `npm run release` + push `main` → 自动重新部署
- 也可在仓库 Actions 页面手动 Run workflow
- `TOKEN_ENC_KEY`（PAT 加密密钥）首次部署自动生成，之后不会变动；换钥匙会导致已存 PAT 无法解密，如需重置需删除该 secret 并重新粘贴所有 PAT

### 本地部署（备选）

`wrangler.jsonc` 无需配置 database_id：首次 `npm run deploy` 会自动创建名为 `cronjob_db` 的 D1 数据库，之后按名称自动连接。

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put TOKEN_ENC_KEY   # 建议 openssl rand -hex 32
npm run db:init                          # 建表（幂等）
npm run deploy
```

## 使用说明

### 快速上手

1. 打开管理页，用部署时设置的 `ADMIN_PASSWORD` 登录。
2. 「账号」页点「+ 添加账号」，填备注名并粘贴 PAT（建议 fine-grained，需 workflow / repo 权限）；勾选「保存时在线验证 Token」可当场确认可用。
3. 「任务」页新建任务：选 GitHub 账号 → 填仓库 `owner/repo` → 选触发方式（`workflow_dispatch` 需填 workflow 文件名与分支 / ref；`repository_dispatch` 需填 event_type）→ 配调度规则（cron / 固定间隔 / 随机间隔）。
4. 任务列表里可随时启用 / 停用任务，或点「立即触发」手动执行一次。
5. 「运行记录」页查看每次触发的时间、来源、状态、HTTP 码与错误信息。

### 注意事项

- GitHub 仓库的 workflow 需声明对应触发器：
  - `workflow_dispatch`：workflow 文件里写 `on: workflow_dispatch`（可带 inputs）
  - `repository_dispatch`：workflow 文件里写 `on: repository_dispatch: [事件类型]`
- cron 表达式按 **UTC** 计算（北京时间减 8 小时）。
- 调度器每 5 分钟扫描一次到期任务；Cloudflare 免费计划可能有约 1 分钟的 cron 延迟。

## 技术栈

Hono · React 18 · Vite · Tailwind CSS v4 · Cloudflare Workers · D1 · Vitest
