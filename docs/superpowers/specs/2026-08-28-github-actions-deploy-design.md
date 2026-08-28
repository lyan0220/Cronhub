# GitHub Actions 自动部署 —— 设计文档

日期：2026-08-28
状态：已与用户确认

## 1. 背景

现有部署流程（`wrangler d1 create` → 手抄 database_id 改 `wrangler.jsonc` → `db:init` → `wrangler secret put` ×2 → `deploy`）步骤多、需要改代码文件，用户不满意。用户习惯从 GitHub 仓库部署，希望：不手填 database_id、一条通道全自动、首次部署无引导全自动、push 即部署。

## 2. 已确认的需求决策

| 决策点 | 结论 |
|---|---|
| 部署渠道 | GitHub Actions（`.github/workflows/deploy.yml`） |
| 首次部署引导 | 全部交给 CI，无本地 setup 脚本 |
| 触发分支 | push 到 `main` 和 `dev` 均部署；另支持 workflow_dispatch 手动触发 |
| database_id | **直接从 `wrangler.jsonc` 删除**（调研验证：wrangler 4.x 配置校验中 database_id 为 optional；deploy 时 D1Handler 按 `database_name` 自动连接已有库、不存在则自动创建）。无 CI 注入逻辑，代码文件永久零改动 |
| TOKEN_ENC_KEY | CI 检测不存在时自动生成随机 32 字节写入；**已存在绝不覆盖**（换钥匙导致已存 PAT 无法解密） |
| ADMIN_PASSWORD | 由用户放在 GitHub repo secret；repo secret 有值则每次覆盖同步（改密码 = 改 repo secret 再 push） |

## 3. CI 流程设计

```
push 到 main/dev（或手动触发）
  ① npm ci → npm run build
  ② npx wrangler deploy
     D1 绑定按 database_name 自动解析：
     库 "cronjob" 已存在 → 自动连接；不存在 → 自动创建
     （同时部署 cron 触发器与静态资源）
  ③ npx wrangler d1 execute cronjob --remote --file=src/schema.sql
     （IF NOT EXISTS，幂等，可重复执行；按名称解析）
  ④ 密钥同步（wrangler secret list 默认输出 JSON 数组）：
     a. TOKEN_ENC_KEY 不存在 → openssl rand -hex 32 生成并写入
        已存在 → 跳过（绝不覆盖：换钥匙导致已存 PAT 无法解密）
     b. secrets.ADMIN_PASSWORD 非空 → 写入（改密码 = 改 repo secret 再 push）
        为空 → 跳过并在日志中提醒
```

顺序约束：④ 必须在 ② 之后（`wrangler secret put/list` 要求 Worker 已存在）。
已用本地 wrangler 4.127（与 npm latest 一致）验证：省略 database_id 的配置通过 `deploy --dry-run` 校验与打包。

## 4. 用户一次性配置（GitHub repo secrets，3 个）

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 权限：Workers Scripts:Edit、D1:Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard 账户页可复制 |
| `ADMIN_PASSWORD` | 管理页登录密码 |

## 5. 兼容性

- 本地开发不受影响：`npm run dev` 使用本地 D1（`.wrangler/state`），按 `database_name` 解析，不需要真实 database_id
- 手动本地部署（`npm run deploy`）同样受益：无需配置任何 ID，首次运行自动建库
- `wrangler.jsonc` 删除 `database_id` 后无占位符；本地 `db:init`/`db:local` 脚本不变（均按名称操作）

## 6. 交付物

1. `.github/workflows/deploy.yml` —— 全流程 workflow
2. `README.md` —— 部署章节改为「配置 3 个 repo secrets → push 即部署」，附 API Token 权限创建指引

无代码逻辑改动（src/ 零触碰），无新增单元测试（CI YAML 不在 Vitest 覆盖范围，验证方式为 YAML 语法检查 + 实际 push 部署）。
