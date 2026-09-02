# GitHub Actions 定时触发中心

Cloudflare Worker + D1 应用，定时触发 GitHub Actions workflow。

- 多账号 PAT 管理（AES-GCM 加密存储，在线验证）
- 多仓库，任务独立调度：cron / 固定间隔 / 随机间隔
- 两种触发方式：workflow_dispatch、repository_dispatch
- 运行记录（时间 / 状态 / HTTP 码 / 错误信息），支持手动触发
- Web 管理页，单管理密码登录

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 填 ADMIN_PASSWORD、TOKEN_ENC_KEY
npm run db:local
npm run dev                      # http://localhost:5173
```

测试本地 scheduled：

```bash
npm run build
npx wrangler dev --test-scheduled
curl "http://localhost:8787/cdn-cgi/local/scheduled?format=json"
```

## 开发与发布

远程仓库只保留 `main` 分支，push `main` 自动部署。

- 生产代码与构建/部署配置（`src/`、`wrangler.jsonc`、deploy workflow 等）：提交到 `main`
- 测试（`test/`、`vitest.config.ts`）、计划/设计文档（`docs/`）、本地调试配置（`.dev.vars.example`）：已加入 `.gitignore`，仅保存在本地，不提交到远程

发布：

```bash
git push origin main
```

## 测试（仅本地）

测试文件不入库，仅本地保留：

```bash
npm run test        # Vitest，覆盖服务端路由与客户端纯逻辑
npm run typecheck
```

## 部署

GitHub 仓库 Settings → Secrets and variables → Actions 添加 3 个 secret：

| Secret | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | My Profile → API Tokens → Create Token（Edit Cloudflare Workers 模板，含 Workers Scripts:Edit、D1:Edit） |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard 首页右侧 Account ID |
| `ADMIN_PASSWORD` | 管理页登录密码 |

push `main` 触发部署。首次部署自动创建 D1（`cronjob_db`）、建表、生成 `TOKEN_ENC_KEY`。

- 改密码：修改 `ADMIN_PASSWORD` secret 后 push `main`
- `TOKEN_ENC_KEY` 仅首次部署生成，之后不覆盖；删除它会导致所有已存 PAT 无法解密，需重新粘贴
- 纯文档修改不触发部署

### 本地部署（备选）

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put TOKEN_ENC_KEY   # openssl rand -hex 32
npm run db:init
npm run deploy
```

无需配置 database_id，首次部署自动创建 `cronjob_db`。

## 使用说明

1. 用 `ADMIN_PASSWORD` 登录管理页。
2. 「账号」页添加账号：备注名 + PAT，可当场验证。
3. 「任务」页新建任务：账号、仓库、触发方式、调度规则。
4. 任务列表支持启停、立即触发、编辑、删除。
5. 「运行记录」页查看每次触发详情。

### PAT 权限

| 类型 | 权限 |
|---|---|
| classic | `repo` scope |
| fine-grained | Repository permissions 中 **Actions** 与 **Contents** 均设 **Read and write** |

### 触发方式：workflow_dispatch

目标仓库的 workflow 添加触发器：

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

目标仓库的 workflow 添加触发器：

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

注意：GitHub 要求被触发的 workflow 文件已存在于目标仓库的默认分支，两种方式都受此限制。仅存在于其他分支的 workflow 无法被触发。

### 故障排查

| HTTP 码 | 原因 |
|---|---|
| 404 | 仓库或 workflow 不存在，PAT 无仓库权限 |
| 422 | ref 不存在，workflow 缺少对应触发器声明 |
| 403 | PAT 权限不足 |

### 其他

- cron 按 UTC 计算，北京时间减 8 小时。
- 调度每 5 分钟扫描一次；免费计划 cron 延迟约 1 分钟。

## 技术栈

Hono · React 18 · Vite · Tailwind CSS v4 · Cloudflare Workers · D1 · Vitest
