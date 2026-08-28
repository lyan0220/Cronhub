# GitHub Actions 自动部署 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** push 到 GitHub 即自动部署（自动建库/建表/管理密钥），`wrangler.jsonc` 删除 database_id 永久零手改。

**Architecture:** 单 workflow（checkout → build → deploy → 建表 → 密钥同步）。D1 绑定按 `database_name` 自动解析（wrangler 4.x 原生特性，已源码+dry-run 验证）。TOKEN_ENC_KEY 首次由 CI 生成后绝不覆盖。

**Tech Stack:** GitHub Actions · wrangler 4.127 · 现有 npm scripts

## Global Constraints

- spec：docs/superpowers/specs/2026-08-28-github-actions-deploy-design.md
- workflow 触发：push 到 `main` 与 `dev` + `workflow_dispatch`
- 所需 GitHub repo secrets：`CLOUDFLARE_API_TOKEN`（权限 Workers Scripts:Edit + D1:Edit）、`CLOUDFLARE_ACCOUNT_ID`、`ADMIN_PASSWORD`
- TOKEN_ENC_KEY：仅当 Worker 尚无此 secret 时生成写入（`openssl rand -hex 32`），已存在一律跳过
- `wrangler secret put` 必须在 `wrangler deploy` 之后（Worker 需已存在）
- src/ 目录零改动；schema.sql 已全部 IF NOT EXISTS（幂等）
- README 中文，部署章节以 CI 为推荐方式，保留本地部署为备选

---

### Task 1: deploy.yml + wrangler.jsonc 去 database_id + README 部署章节重写

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `wrangler.jsonc`（删除 database_id 行）
- Modify: `README.md`（部署章节重写）

**Interfaces:**
- Consumes: 现有 `npm run build`（vite build → dist/client）、`npx wrangler deploy`、`npx wrangler d1 execute cronjob --remote --file=src/schema.sql`（按名称解析）、`npx wrangler secret list`（默认输出 JSON 数组，空为 `[]`）
- Produces: 无代码接口；产出为 CI 部署通道

- [ ] **Step 1: 修改 wrangler.jsonc**

删除 `database_id` 行（含逗号），d1_databases 块变为：

```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cronjob"
    }
  ]
```

- [ ] **Step 2: dry-run 验证配置仍合法**

Run: `npm run build && npx wrangler deploy --dry-run --outdir /tmp/dryrun-out`
Expected: 输出 `env.DB (cronjob) D1 Database`，无报错，退出码 0

- [ ] **Step 3: 写 .github/workflows/deploy.yml**

```yaml
name: Deploy

on:
  push:
    branches: [main, dev]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - run: npm run build

      - name: 部署 Worker（首次运行自动创建 D1 数据库）
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: 初始化数据库表（幂等）
        run: npx wrangler d1 execute cronjob --remote --file=src/schema.sql
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: 同步密钥
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          ADMIN_PASSWORD: ${{ secrets.ADMIN_PASSWORD }}
        run: |
          set -e
          EXISTING=$(npx wrangler secret list | jq -r '.[].name' || true)

          # TOKEN_ENC_KEY：首次生成，之后绝不覆盖（换钥匙会导致已存 PAT 无法解密）
          if ! echo "$EXISTING" | grep -qx 'TOKEN_ENC_KEY'; then
            echo "首次部署：自动生成 TOKEN_ENC_KEY"
            openssl rand -hex 32 | npx wrangler secret put TOKEN_ENC_KEY
          else
            echo "TOKEN_ENC_KEY 已存在，跳过"
          fi

          # ADMIN_PASSWORD：repo secret 有值则同步（改密码 = 改 repo secret 再 push）
          if [ -n "$ADMIN_PASSWORD" ]; then
            printf '%s' "$ADMIN_PASSWORD" | npx wrangler secret put ADMIN_PASSWORD
          else
            echo "::warning::未设置 ADMIN_PASSWORD repo secret，管理页将无法登录"
          fi
```

- [ ] **Step 4: YAML 语法验证**

Run: `node -e "const yaml=require('js-yaml');yaml.load(require('fs').readFileSync('.github/workflows/deploy.yml','utf8'));console.log('YAML OK')"`
（若 js-yaml 不可用：`npx --yes js-yaml .github/workflows/deploy.yml > /dev/null && echo OK`）
Expected: `YAML OK`

- [ ] **Step 5: 重写 README 部署章节**

替换现有「## 部署」整节为：

```markdown
## 部署（推荐：GitHub Actions 自动部署）

push 到 `main` 或 `dev` 分支即自动部署；首次部署会自动创建 D1 数据库、建表并生成加密密钥。

只需一次性在 GitHub 仓库 Settings → Secrets and variables → Actions 添加 3 个 secret：

| Secret | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens → Create Token，模板选 "Edit Cloudflare Workers"，确保包含 **Workers Scripts:Edit** 与 **D1:Edit** 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard 首页右侧 Account ID |
| `ADMIN_PASSWORD` | 管理页登录密码（想改密码就改这里再 push） |

配置完成后 push 一次代码即完成首次部署。之后：

- 代码改动 push 到 `main`/`dev` → 自动重新部署
- 也可在仓库 Actions 页面手动 Run workflow
- `TOKEN_ENC_KEY`（PAT 加密密钥）首次部署自动生成，之后不会变动；换钥匙会导致已存 PAT 无法解密，如需重置需删除该 secret 并重新粘贴所有 PAT

### 本地部署（备选）

`wrangler.jsonc` 无需配置 database_id：首次 `npm run deploy` 会自动创建名为 `cronjob` 的 D1 数据库，之后按名称自动连接。

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put TOKEN_ENC_KEY   # 建议 openssl rand -hex 32
npm run db:init                          # 建表（幂等）
npm run deploy
```
```

- [ ] **Step 6: 回归验证**

Run: `npm test && npm run typecheck`
Expected: 83/83 通过，typecheck 0 错误（src/ 零改动，应无回归）

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/deploy.yml wrangler.jsonc README.md
git commit -m "feat: GitHub Actions 自动部署, D1 按名称自动创建/连接"
```
