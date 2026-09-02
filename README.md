# GitHub Actions 定时触发中心

部署在 Cloudflare Workers + D1 上的定时任务服务：配置 GitHub 账号与任务规则，按计划自动触发目标仓库的 GitHub Actions workflow。

## 功能

- **多账号管理**：多个 GitHub 账号的 PAT，AES-GCM 加密存储，支持在线验证
- **定时任务**：每个任务独立调度，支持 cron 表达式、固定间隔、随机间隔三种规则，可随时启停
- **两种触发方式**：workflow_dispatch（可指定分支、传 inputs）、repository_dispatch（client_payload 传参）
- **运行记录**：记录每次触发的时间、状态、HTTP 码、错误信息，支持手动立即触发
- **Web 管理页**：单密码登录，支持在页面内修改密码，账号 / 任务 / 运行记录统一管理

## 部署

### 方式一：GitHub Actions 自动部署（推荐）

1. 将本仓库 Fork 到你的 GitHub 账号。
2. 仓库 Settings → Secrets and variables → Actions，添加 3 个 secret：

| Secret | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare My Profile → API Tokens → Create Token，使用 Edit Cloudflare Workers 模板（含 Workers Scripts:Edit、D1:Edit） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard 首页右侧 Account ID |
| `ADMIN_PASSWORD` | 初始登录密码（仅在从未于页面内改密时生效，见下） |

3. push `main` 分支即触发自动部署。

首次部署自动完成：创建 D1 数据库（`cronjob_db`）、建表、生成 `TOKEN_ENC_KEY` 加密密钥。

注意事项：

- `TOKEN_ENC_KEY` 仅首次部署生成，之后不覆盖；删除会导致所有已存 PAT 无法解密，需重新录入

改密码：

- 登录后点击顶栏账户菜单 →「修改密码」，需验证当前密码；改密成功后所有登录会话立即失效，需重新登录
- 密码哈希存入 D1 数据库并优先于 `ADMIN_PASSWORD` 环境变量，因此**在页面内改密后，修改 `ADMIN_PASSWORD` secret 不再影响登录密码**
- 忘记密码：删除数据库中的密码哈希，即可回退用 `ADMIN_PASSWORD` 登录：

  ```bash
  npx wrangler d1 execute cronjob_db --remote --command "DELETE FROM settings WHERE key='admin_password_hash'"
  ```

  若 `ADMIN_PASSWORD` 本身也忘了，先更新该 secret 并重新部署，再执行上面的命令。

### 方式二：本地部署

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put TOKEN_ENC_KEY   # openssl rand -hex 32
npm run db:init
npm run deploy
```

无需预配置 database_id，首次部署自动创建 `cronjob_db`。

## 使用说明

1. 用初始密码 `ADMIN_PASSWORD` 登录管理页（后续可在页面内修改，见「部署 → 改密码」）。
2. 「账号」页添加 GitHub 账号：备注名 + PAT，可当场验证连通性。
3. 「任务」页新建任务：选择账号、填写仓库、选择触发方式与调度规则。
4. 任务列表支持启停、立即触发、编辑、删除。
5. 「运行记录」页查看每次触发的详情。

### PAT 权限要求

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
- 调度每 5 分钟扫描一次；Cloudflare 免费计划的 cron 触发延迟约 1 分钟。

## 技术栈

Hono · React 18 · Vite · Tailwind CSS v4 · Cloudflare Workers · D1 · Vitest

## 许可证

[MIT](LICENSE)

