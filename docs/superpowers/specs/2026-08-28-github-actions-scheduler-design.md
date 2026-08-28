# GitHub Actions 定时触发中心 —— 设计文档

日期：2026-08-28
状态：已与用户确认

## 1. 项目目标

基于 Cloudflare Worker + D1 构建一个 GitHub Actions 定时触发中心：

- **多账号**：管理多个 GitHub 账号的 PAT
- **多仓库**：任意 `owner/repo` 组合
- **任意时间**：任务可配 cron 表达式或随机/固定间隔，互相独立
- **前端管理**：优秀的 Web 管理页，随时增删改配置、查看运行记录、手动触发

## 2. 已确认的需求决策

| 决策点 | 结论 |
|---|---|
| 触发机制 | workflow_dispatch 与 repository_dispatch 两者都支持，任务级可选 |
| 调度精度 | 每 5 分钟扫描一次 |
| Token 存储 | PAT 用 AES-GCM 加密存 D1，密钥为 Worker Secret |
| 管理页认证 | 单管理密码，签名 Cookie 会话（7 天有效） |
| 前端形态 | React SPA 嵌入同一 Worker，同域名服务 |
| 调度表达式 | 标准 cron + 固定间隔 + 随机间隔 |
| 运行记录 | 完整记录每次触发（时间/状态/HTTP 码/错误），支持手动立即触发（重试即再次手动触发） |
| Token 验证 | 添加账号时支持在线验证（调 GitHub /user） |
| 技术栈 | Hono（后端）+ React/Vite/Tailwind（前端）+ @cloudflare/vite-plugin |

## 3. 架构（方案 A：中心调度器模式）

```
┌─────────────────────────────────────────────────┐
│                Cloudflare Worker                 │
│                                                  │
│  fetch handler                    scheduled      │
│  ├─ /api/*  → Hono REST API       handler        │
│  │   (登录认证、账号/任务/日志 CRUD)   每5分钟:      │
│  └─ /*      → 静态资源(React SPA)   ├─ 查 D1 到期任务│
│                                    ├─ 逐个调      │
│  ┌──────────────────────────┐      │  GitHub API │
│  │ D1 (SQLite)              │◄─────┘  触发        │
│  │ accounts / jobs / runs   │      └─ 写回下次数行 │
│  └──────────────────────────┘         时间+记录    │
│                                                  │
│  Secrets: ADMIN_PASSWORD, TOKEN_ENC_KEY          │
└────────────────────────┬─────────────────────────┘
                         │ HTTPS (workflow_dispatch /
                         │  repository_dispatch)
                         ▼
                  GitHub API (多账号)
```

单一部署单元：Hono + React 通过 Cloudflare 官方 Vite 插件一体构建，`wrangler deploy` 一次部署 Worker 代码、前端静态资源、D1 绑定与 cron 触发器。

### 调度流程（scheduled handler，每 5 分钟）

1. `SELECT * FROM jobs WHERE enabled=1 AND next_run_at <= now`（单次最多 50 条）
2. 对每个任务：取所属账号的 token，调 GitHub API 触发（类型由任务配置决定）
3. 结果写入 `runs` 表；按调度规则计算新 `next_run_at` 写回
4. 逐任务 try/catch，单个失败不影响其余
5. 顺带清理 90 天前的 runs 记录

### 安全

- 管理 API 除登录外全部要求会话 Cookie；密码错误连续 5 次锁定 10 分钟
- 会话为无状态签名 Cookie：`exp.signature`，HMAC-SHA256，密钥从 `ADMIN_PASSWORD` 派生；密码比较用恒定时间比较
- PAT 用 AES-GCM 加密存 D1（密钥 = Worker Secret `TOKEN_ENC_KEY`）；API 永不回传明文，仅返回掩码（`ghp_****abcd`）与指纹

## 4. 数据模型（D1）

```sql
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,            -- 备注名
  github_login TEXT,             -- 验证时从 /user 拉取
  token_encrypted TEXT NOT NULL, -- AES-GCM 密文(base64)
  token_fingerprint TEXT,        -- 如 "****abcd"，展示用
  status TEXT DEFAULT 'unknown', -- ok | invalid | unknown
  last_verified_at INTEGER,
  created_at INTEGER, updated_at INTEGER
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,            -- "owner/repo"
  trigger_type TEXT NOT NULL,    -- 'workflow_dispatch' | 'repository_dispatch'
  workflow_id TEXT,              -- workflow 文件名或 ID（workflow_dispatch 用）
  event_type TEXT,               -- repository_dispatch 的事件类型
  ref TEXT DEFAULT 'main',       -- workflow_dispatch 指定分支
  inputs_json TEXT,              -- workflow_dispatch inputs / dispatch client_payload
  schedule_json TEXT NOT NULL,   -- 调度规则
  enabled INTEGER DEFAULT 1,
  next_run_at INTEGER NOT NULL,  -- 下次应触发时间(epoch ms)
  last_run_at INTEGER,
  created_at INTEGER, updated_at INTEGER
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  triggered_at INTEGER NOT NULL,
  source TEXT NOT NULL,          -- 'schedule' | 'manual'
  status TEXT NOT NULL,          -- 'success' | 'failed'
  http_status INTEGER,
  error_message TEXT
);
CREATE INDEX idx_runs_job ON runs(job_id, triggered_at DESC);
CREATE INDEX idx_jobs_due ON jobs(enabled, next_run_at);
```

### 调度规则 schedule_json

```jsonc
// 类型1：标准 cron（5 字段：分 时 日 月 周）
{ "type": "cron", "expr": "30 3 * * *" }

// 类型2：间隔
// mode: "fixed" 固定间隔 | "random" 随机间隔
// unit: "m" | "h" | "d"
{ "type": "interval", "mode": "fixed", "value": 45, "unit": "m" }
{ "type": "interval", "mode": "random", "min": 30, "max": 90, "unit": "m" }
```

- random 语义：每次触发后，在 `[min, max]` 内随机取下一次间隔（防固定时刻特征）
- 自带轻量 5 字段 cron 解析器（支持 `*`、`*/n`、区间 `a-b`、列表 `a,b,c`），不引入外部 cron 库
- `next_run_at` 基于原计划触发时间累加，避免累积漂移

## 5. API 设计

统一前缀 `/api/*`，除登录外均需会话。响应统一 `{ ok, data }` / `{ ok: false, error }`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 密码换会话 Cookie（限速：错 5 次锁 10 分钟） |
| POST | `/api/auth/logout` | 清除会话 |
| GET | `/api/auth/me` | 会话有效性检查 |
| GET | `/api/accounts` | 账号列表（token 仅掩码/指纹/状态） |
| POST | `/api/accounts` | 新增；可选 `verify:true` 当场验证 |
| POST | `/api/accounts/:id/verify` | 重新验证 |
| PUT | `/api/accounts/:id` | 更新（换 token 重新加密+验证） |
| DELETE | `/api/accounts/:id` | 删除（级联删任务） |
| GET | `/api/jobs` | 任务列表（join 账号名、下次/上次运行时间） |
| POST | `/api/jobs` | 新增（服务端算 next_run_at） |
| PUT | `/api/jobs/:id` | 更新（改调度后重算 next_run_at） |
| POST | `/api/jobs/:id/toggle` | 启用/停用 |
| POST | `/api/jobs/:id/trigger` | 手动立即触发（source='manual'） |
| DELETE | `/api/jobs/:id` | 删除 |
| GET | `/api/runs?job_id=&page=` | 运行记录分页（每页 50） |
| POST | `/api/runs/cleanup` | 手动清理过期记录 |
| GET | `/api/cron/preview` | 传调度规则，返回未来 5 次触发时间（表单实时预览） |

### GitHub API 触发

- workflow_dispatch：`POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`，body `{ ref, inputs }`
- repository_dispatch：`POST /repos/{owner}/{repo}/dispatches`，body `{ event_type, client_payload }`
- 请求头：`Authorization: Bearer <token>`、`Accept: application/vnd.github+json`；超时 15s

## 6. 前端页面（React SPA）

Tailwind，深/浅色跟随系统，左侧导航 + 主内容区。四个页面：

1. **仪表盘 `/`**：统计卡片（账号数、任务数、启用中、今日触发数、近 24h 失败数）+ 最近 20 条运行流水，失败红色高亮
2. **任务管理 `/jobs`**：表格（名称、账号、仓库、触发类型、调度摘要、下次运行、状态开关、操作）。新建/编辑为表单抽屉：选账号 → 仓库 → 触发类型相关字段（workflow_id/ref/inputs 或 event_type/payload）→ 调度规则区（cron / 固定间隔 / 随机间隔切换，右侧实时"未来 5 次触发时间"预览）
3. **账号管理 `/accounts`**：卡片列表（头像+登录名、备注名、token 掩码、验证徽章、上次验证时间）。新增时粘贴 token 一键验证
4. **运行记录 `/runs`**：全部记录，按任务/状态筛选、分页；失败条目展开显示 HTTP 状态码与错误信息

交互：增删改带确认；删除账号提示级联删除；toast 反馈；表格开关直接切换启用状态。

## 7. 错误处理与边界

- **GitHub API 失败**（401/404/403）：记 runs 失败记录含详情；401 时将账号 `status` 置 `invalid`
- **触发超时**：15s AbortController 超时，防拖慢 scheduled handler
- **防重复触发**：乐观锁 `UPDATE jobs SET next_run_at=? WHERE id=? AND next_run_at=?`，cron 重叠也不会重复触发
- **时钟漂移**：next_run_at 基于原计划时间累加
- **runs 膨胀**：保留 90 天，调度时顺带清理
- **D1 免费配额**：单次调度最多处理 50 个到期任务，超出留下个周期

## 8. 测试与部署

- **单元测试（Vitest）**：cron 解析与下次时间计算、随机间隔计算、AES-GCM 加解密、会话签名。纯函数全覆盖
- **集成**：`wrangler dev` 本地完整环境（本地 D1 + Miniflare 模拟 scheduled），手动触发 scheduled 验证全链路
- **部署**：`wrangler d1 create` → 设置 2 个 Secret（ADMIN_PASSWORD、TOKEN_ENC_KEY）→ `npm run deploy`；README 写完整步骤

## 9. 项目结构（预期）

```
cronjob/
├─ wrangler.jsonc          # Worker/D1/cron/静态资源配置
├─ src/
│  ├─ worker.ts            # 入口：fetch + scheduled
│  ├─ server/              # Hono API
│  │  ├─ routes/           # auth / accounts / jobs / runs / cron-preview
│  │  ├─ middleware/       # 会话认证、限速
│  │  ├─ crypto.ts         # AES-GCM、HMAC 会话
│  │  ├─ github.ts         # GitHub API 客户端
│  │  ├─ scheduler.ts      # 调度核心：到期查询、触发、写回
│  │  └─ cron.ts           # cron 解析器与下次时间计算
│  ├─ client/              # React SPA
│  │  ├─ App.tsx / pages/  # Dashboard / Jobs / Accounts / Runs
│  │  ├─ components/       # 表格、表单抽屉、toast 等
│  │  └─ api.ts            # 前端 API 封装
│  └─ schema.sql           # D1 建表语句
├─ test/                   # Vitest 单测
└─ package.json
```
