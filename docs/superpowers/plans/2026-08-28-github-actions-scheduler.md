# GitHub Actions 定时触发中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 Cloudflare Worker + D1 构建多账号多仓库的 GitHub Actions 定时触发中心，含完整前端管理页。

**Architecture:** 单 Worker：fetch handler 服务 Hono REST API（/api/*）与 React SPA 静态资源；scheduled handler（每 5 分钟 cron）扫描 D1 到期任务，逐个调 GitHub API 触发并写回下次运行时间。PAT 以 AES-GCM 加密存 D1。

**Tech Stack:** Hono、React 18、React Router、Vite、Tailwind CSS v4、@cloudflare/vite-plugin、D1、Vitest（node 环境，纯函数/注入依赖单测）、wrangler。

**规格文档:** `docs/superpowers/specs/2026-08-28-github-actions-scheduler-design.md`

**与规格的差异说明:** 规格的 API 表遗漏了仪表盘所需的统计端点，本计划新增 `GET /api/stats`（Task 10 实现），其余与规格一致。

## Global Constraints

- Node ≥ 20，npm 作为包管理器；所有命令在项目根 `d:\Projects\Work\Cronjob` 执行
- 所有时间戳一律为 epoch 毫秒数；cron 表达式按 **UTC** 时区计算（前端需提示）
- API 响应统一 `{ ok: true, data }` 或 `{ ok: false, error }`（HTTP 状态码同时体现错误）
- UI 文案全部使用中文
- 测试命令：`npm test`；类型检查：`npm run typecheck`
- 密码/密钥不硬编码：`ADMIN_PASSWORD`、`TOKEN_ENC_KEY` 通过 Secret / `.dev.vars` 提供
- 测试文件放 `test/` 目录；服务端纯逻辑与路由层均用单测（路由层用 `test/helpers/fake-d1.ts` 的 FakeD1）
- 每个 Task 结束必须 commit

---

### Task 1: 项目脚手架与构建链

**Files:**
- Create: `package.json`, `wrangler.jsonc`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `.gitignore`, `.dev.vars.example`, `index.html`, `src/worker.ts`, `src/schema.sql`, `src/client/index.css`, `src/client/main.tsx`

**Interfaces:**
- Produces: 构建脚本 `dev/build/deploy/test/typecheck`；`src/worker.ts` 默认导出 `ExportedHandler`（后续任务逐步扩展）；`src/schema.sql` 定义三张表

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "cronjob",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "deploy": "npm run build && wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:local": "wrangler d1 execute cronjob --local --file=src/schema.sql",
    "db:init": "wrangler d1 execute cronjob --remote --file=src/schema.sql"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "^1.0.0",
    "@cloudflare/workers-types": "^4.20260101.0",
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: 创建 wrangler.jsonc**

```jsonc
{
  "name": "cronjob",
  "main": "src/worker.ts",
  "compatibility_date": "2026-08-01",
  "triggers": { "crons": ["*/5 * * * *"] },
  "assets": {
    "directory": "./dist/client",
    "not_found_handling": "single-page-application"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cronjob",
      "database_id": "00000000-0000-0000-0000-000000000000"
    }
  ]
}
```

注意：`database_id` 为占位值，部署前须替换为 `wrangler d1 create cronjob` 返回的真实 ID（README 在 Task 16 说明）；本地开发不受影响。

- [ ] **Step 3: 创建 vite.config.ts 与 vitest.config.ts**

`vite.config.ts`：

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  build: { outDir: "dist/client", emptyOutDir: true },
});
```

`vitest.config.ts`（独立于 vite 配置，避免加载 cloudflare 插件，单测跑在纯 node 环境）：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 4: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "vite/client"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 5: 创建 .gitignore 与 .dev.vars.example**

`.gitignore`：

```
node_modules/
dist/
.wrangler/
.dev.vars
```

`.dev.vars.example`：

```
ADMIN_PASSWORD=change-me
TOKEN_ENC_KEY=openssl-rand-hex-32-输出粘贴到这里
```

- [ ] **Step 6: 创建 index.html（项目根）**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Actions 定时中心</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: 创建 src/schema.sql**

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  github_login TEXT,
  token_encrypted TEXT NOT NULL,
  token_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  repo TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('workflow_dispatch','repository_dispatch')),
  workflow_id TEXT,
  event_type TEXT,
  ref TEXT,
  inputs_json TEXT,
  schedule_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  triggered_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id, triggered_at DESC);
```

- [ ] **Step 8: 创建 Worker 骨架 src/worker.ts（后续任务扩展）**

```ts
import { Hono } from "hono";

type Env = { DB: D1Database; ASSETS: Fetcher; ADMIN_PASSWORD: string; TOKEN_ENC_KEY: string };

const app = new Hono<{ Bindings: Env }>();
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, _env: Env, _ctx: ExecutionContext) => {},
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 9: 创建前端最小入口 src/client/index.css 与 src/client/main.tsx**

`src/client/index.css`：

```css
@import "tailwindcss";
```

`src/client/main.tsx`：

```tsx
import React from "react";
import ReactDOM from "react-dom/client";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="p-8 text-xl">脚手架就绪</div>
  </React.StrictMode>
);
```

- [ ] **Step 10: 安装依赖并验证构建**

Run: `npm install`
Run: `npm run build`
Expected: 构建成功，生成 `dist/client/`（含 index.html 与 JS/CSS 资源）

Run: `npm run typecheck`
Expected: 无错误

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: 项目脚手架（Vite+Hono+D1+Tailwind 构建链）"
```

---

### Task 2: cron 解析器（src/server/cron.ts）

**Files:**
- Create: `src/server/cron.ts`
- Test: `test/cron.test.ts`

**Interfaces:**
- Produces: `parseCron(expr: string): CronFields`（非法表达式 throw `Error`，中文 message）；`nextCronTime(expr: string, fromMs: number): number`（返回 epoch ms，不含 fromMs 所在分钟，最多向后查 366 天，查不到 throw）；`type CronFields = { minutes: Set<number>; hours: Set<number>; doms: Set<number> | null; dows: Set<number> | null; months: Set<number> }`（doms/dows 为 null 表示该字段是 `*`）

- [ ] **Step 1: 写失败测试 test/cron.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { parseCron, nextCronTime } from "../src/server/cron";

describe("parseCron", () => {
  it("解析 * * * * *", () => {
    const f = parseCron("* * * * *");
    expect(f.minutes.size).toBe(60);
    expect(f.doms).toBeNull();
    expect(f.dows).toBeNull();
  });
  it("支持步长 */15", () => {
    expect(parseCron("*/15 * * * *").minutes).toEqual(new Set([0, 15, 30, 45]));
  });
  it("支持区间与列表 1-3,40", () => {
    expect(parseCron("1-3,40 * * * *").minutes).toEqual(new Set([1, 2, 3, 40]));
  });
  it("支持区间步长 10-50/20", () => {
    expect(parseCron("10-50/20 * * * *").minutes).toEqual(new Set([10, 30, 50]));
  });
  it("星期 7 归一化为 0", () => {
    expect(parseCron("* * * * 7").dows).toEqual(new Set([0]));
  });
  it("拒绝字段数不足", () => {
    expect(() => parseCron("* * * *")).toThrow();
  });
  it("拒绝越界值", () => {
    expect(() => parseCron("61 * * * *")).toThrow();
    expect(() => parseCron("* 24 * * *")).toThrow();
  });
  it("拒绝非法字符", () => {
    expect(() => parseCron("abc * * * *")).toThrow();
  });
});

describe("nextCronTime", () => {
  // 2026-08-28 10:30 UTC 是周五
  const base = Date.UTC(2026, 7, 28, 10, 30);

  it("每小时第 0 分 → 下一整点", () => {
    expect(nextCronTime("0 * * * *", base)).toBe(Date.UTC(2026, 7, 28, 11, 0));
  });
  it("每天 03:30 → 明天", () => {
    expect(nextCronTime("30 3 * * *", base)).toBe(Date.UTC(2026, 7, 29, 3, 30));
  });
  it("下一分钟命中", () => {
    expect(nextCronTime("31 10 * * *", base)).toBe(Date.UTC(2026, 7, 28, 10, 31));
  });
  it("每周五 00:00 → 下周五", () => {
    expect(nextCronTime("0 0 * * 5", base)).toBe(Date.UTC(2026, 8, 4, 0, 0));
  });
  it("日与周同时受限取或语义（周一或每月1号）→ 周一 8/31", () => {
    expect(nextCronTime("0 0 1 * 1", base)).toBe(Date.UTC(2026, 7, 31, 0, 0));
  });
  it("仅日期受限 → 9月1日", () => {
    expect(nextCronTime("0 0 1 * *", base)).toBe(Date.UTC(2026, 8, 1, 0, 0));
  });
  it("找不到未来时间时抛错", () => {
    expect(() => nextCronTime("0 0 30 2 *", base)).toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL，报错模块不存在（cannot resolve `../src/server/cron`）

- [ ] **Step 3: 实现 src/server/cron.ts**

```ts
// 5 字段 cron（分 时 日 月 周）解析与下次触发时间计算。
// 支持 *、a、a-b、a-b/n、*/n、逗号列表；星期 0-7（0 与 7 均为周日）。
// 标准语义：日(dom)与周(dow)同时受限时取“或”；时间按 UTC 计算。

export type CronFields = {
  minutes: Set<number>;
  hours: Set<number>;
  doms: Set<number> | null; // null = 字段为 *
  dows: Set<number> | null;
  months: Set<number>;
};

const RANGE: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // dom
  [1, 12], // month
  [0, 7],  // dow
];

function parseField(field: string, idx: number): Set<number> | null {
  const [min, max] = RANGE[idx];
  const label = ["分", "时", "日", "月", "周"][idx];
  if (field === "*") return null;
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = part.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`cron ${label}字段非法: "${part}"`);
    const step = m[4] ? Number(m[4]) : 1;
    if (step < 1) throw new Error(`cron ${label}字段步长必须≥1: "${part}"`);
    const lo = m[2] !== undefined ? Number(m[2]) : min;
    const hi = m[3] !== undefined ? Number(m[3]) : m[2] !== undefined ? Number(m[2]) : max;
    if (lo < min || hi > max || lo > hi) throw new Error(`cron ${label}字段越界: "${part}"（允许 ${min}-${max}）`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron 表达式必须是 5 个字段: "${expr}"`);
  const dows = parseField(parts[4], 4);
  if (dows) {
    if (dows.has(7)) dows.add(0);
    dows.delete(7);
  }
  return {
    minutes: parseField(parts[0], 0) ?? full(0),
    hours: parseField(parts[1], 1) ?? full(1),
    doms: parseField(parts[2], 2),
    months: parseField(parts[3], 3) ?? full(3),
    dows,
  };
}

function full(idx: number): Set<number> {
  const [min, max] = RANGE[idx];
  const s = new Set<number>();
  for (let v = min; v <= max; v++) s.add(v);
  return s;
}

export function nextCronTime(expr: string, fromMs: number): number {
  const f = parseCron(expr);
  const d = new Date(fromMs);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // 从下一分钟整开始
  const limit = d.getTime() + 366 * 24 * 60 * 60_000;
  for (; d.getTime() <= limit; d.setMinutes(d.getMinutes() + 1)) {
    if (!f.months.has(d.getUTCMonth() + 1)) continue;
    const domMatch = f.doms === null || f.doms.has(d.getUTCDate());
    const dowMatch = f.dows === null || f.dows.has(d.getUTCDay());
    const dayOk = f.doms !== null && f.dows !== null ? domMatch || dowMatch : domMatch && dowMatch;
    if (dayOk && f.hours.has(d.getUTCHours()) && f.minutes.has(d.getUTCMinutes())) {
      return d.getTime();
    }
  }
  throw new Error(`cron 表达式在 366 天内无匹配时间: "${expr}"`);
}
```

注意：`nextCronTime` 内的 `setMinutes`/`getUTCMinutes` 等方法以 UTC 语义使用（Workers 运行时时区即 UTC；测试中用 `Date.UTC` 构造）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS

（若"找不到未来时间"用例耗时明显，属正常——最多遍历约 52 万分钟，亚秒级完成。）

- [ ] **Step 5: Commit**

```bash
git add src/server/cron.ts test/cron.test.ts
git commit -m "feat: 5字段cron解析器与下次触发时间计算"
```

---

### Task 3: 调度规则模块（src/server/schedule.ts）

**Files:**
- Create: `src/server/schedule.ts`
- Test: `test/schedule.test.ts`

**Interfaces:**
- Consumes: `nextCronTime`、`parseCron`（Task 2）
- Produces:
  - `type Unit = "m" | "h" | "d"`；`type ScheduleRule = { type: "cron"; expr: string } | { type: "interval"; mode: "fixed"; value: number; unit: Unit } | { type: "interval"; mode: "random"; min: number; max: number; unit: Unit }`
  - `validateSchedule(input: unknown): { ok: true; rule: ScheduleRule } | { ok: false; error: string }`
  - `computeNextRun(rule: ScheduleRule, plannedAt: number, rand?: () => number): number`
  - `describeSchedule(rule: ScheduleRule): string`
  - `previewRuns(rule: ScheduleRule, count?: number): number[]`

- [ ] **Step 1: 写失败测试 test/schedule.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { validateSchedule, computeNextRun, describeSchedule } from "../src/server/schedule";

const M = 60_000, H = 3_600_000, D = 86_400_000;

describe("validateSchedule", () => {
  it("接受合法 cron", () => {
    expect(validateSchedule({ type: "cron", expr: "30 3 * * *" })).toEqual({ ok: true, rule: { type: "cron", expr: "30 3 * * *" } });
  });
  it("拒绝非法 cron 并给出中文错误", () => {
    const r = validateSchedule({ type: "cron", expr: "61 * * * *" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("cron");
  });
  it("接受固定间隔", () => {
    expect(validateSchedule({ type: "interval", mode: "fixed", value: 45, unit: "m" }).ok).toBe(true);
  });
  it("拒绝非法单位与数值", () => {
    expect(validateSchedule({ type: "interval", mode: "fixed", value: 45, unit: "s" }).ok).toBe(false);
    expect(validateSchedule({ type: "interval", mode: "fixed", value: 0, unit: "m" }).ok).toBe(false);
  });
  it("拒绝 min>max 的随机间隔", () => {
    expect(validateSchedule({ type: "interval", mode: "random", min: 90, max: 30, unit: "m" }).ok).toBe(false);
  });
  it("拒绝未知类型", () => {
    expect(validateSchedule({ type: "nope" }).ok).toBe(false);
    expect(validateSchedule("x").ok).toBe(false);
  });
});

describe("computeNextRun", () => {
  it("固定间隔基于计划时间累加", () => {
    expect(computeNextRun({ type: "interval", mode: "fixed", value: 45, unit: "m" }, 1000)).toBe(1000 + 45 * M);
    expect(computeNextRun({ type: "interval", mode: "fixed", value: 6, unit: "h" }, 0)).toBe(6 * H);
    expect(computeNextRun({ type: "interval", mode: "fixed", value: 2, unit: "d" }, 0)).toBe(2 * D);
  });
  it("随机间隔使用注入的 rand 并落在 [min,max]", () => {
    expect(computeNextRun({ type: "interval", mode: "random", min: 30, max: 90, unit: "m" }, 0, () => 0)).toBe(30 * M);
    expect(computeNextRun({ type: "interval", mode: "random", min: 30, max: 90, unit: "m" }, 0, () => 0.999999)).toBeGreaterThanOrEqual(30 * M);
    expect(computeNextRun({ type: "interval", mode: "random", min: 30, max: 90, unit: "m" }, 0, () => 0.999999)).toBeLessThan(90 * M);
    expect(computeNextRun({ type: "interval", mode: "random", min: 30, max: 90, unit: "m" }, 0, () => 0.5)).toBe(60 * M);
  });
  it("cron 类型委托给 nextCronTime", () => {
    const base = Date.UTC(2026, 7, 28, 10, 30);
    expect(computeNextRun({ type: "cron", expr: "31 10 * * *" }, base)).toBe(Date.UTC(2026, 7, 28, 10, 31));
  });
});

describe("describeSchedule", () => {
  it("cron", () => expect(describeSchedule({ type: "cron", expr: "30 3 * * *" })).toContain("30 3 * * *"));
  it("固定间隔", () => expect(describeSchedule({ type: "interval", mode: "fixed", value: 45, unit: "m" })).toContain("45"));
  it("随机间隔", () => expect(describeSchedule({ type: "interval", mode: "random", min: 30, max: 90, unit: "m" })).toContain("30~90"));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 src/server/schedule.ts**

```ts
import { nextCronTime, parseCron } from "./cron";

export type Unit = "m" | "h" | "d";
export type ScheduleRule =
  | { type: "cron"; expr: string }
  | { type: "interval"; mode: "fixed"; value: number; unit: Unit }
  | { type: "interval"; mode: "random"; min: number; max: number; unit: Unit };

export const UNIT_MS: Record<Unit, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

export function validateSchedule(input: unknown): { ok: true; rule: ScheduleRule } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "调度规则必须是 JSON 对象" };
  const r = input as Record<string, unknown>;
  if (r.type === "cron") {
    if (typeof r.expr !== "string" || !r.expr.trim()) return { ok: false, error: "cron 表达式缺失" };
    try {
      parseCron(r.expr);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    return { ok: true, rule: { type: "cron", expr: r.expr.trim() } };
  }
  if (r.type === "interval") {
    const unit = r.unit as Unit;
    if (!UNIT_MS[unit]) return { ok: false, error: "间隔单位必须是 m / h / d" };
    if (r.mode === "fixed") {
      const value = Number(r.value);
      if (!Number.isInteger(value) || value < 1 || value > 1000) return { ok: false, error: "间隔值必须是 1-1000 的整数" };
      return { ok: true, rule: { type: "interval", mode: "fixed", value, unit } };
    }
    if (r.mode === "random") {
      const min = Number(r.min), max = Number(r.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || min > 100_000 || max > 100_000 || max < min)
        return { ok: false, error: "随机间隔需满足 1 ≤ min ≤ max ≤ 100000" };
      return { ok: true, rule: { type: "interval", mode: "random", min, max, unit } };
    }
    return { ok: false, error: "间隔模式必须是 fixed / random" };
  }
  return { ok: false, error: "调度类型必须是 cron / interval" };
}

export function computeNextRun(rule: ScheduleRule, plannedAt: number, rand: () => number = Math.random): number {
  if (rule.type === "cron") return nextCronTime(rule.expr, plannedAt);
  const ms = UNIT_MS[rule.unit];
  if (rule.mode === "fixed") return plannedAt + rule.value * ms;
  return plannedAt + (rule.min + rand() * (rule.max - rule.min)) * ms;
}

const UNIT_NAME: Record<Unit, string> = { m: "分钟", h: "小时", d: "天" };

export function describeSchedule(rule: ScheduleRule): string {
  if (rule.type === "cron") return `cron ${rule.expr}`;
  if (rule.mode === "fixed") return `每 ${rule.value} ${UNIT_NAME[rule.unit]}`;
  return `每 ${rule.min}~${rule.max} ${UNIT_NAME[rule.unit]}（随机）`;
}

export function previewRuns(rule: ScheduleRule, count = 5): number[] {
  const out: number[] = [];
  let t = Date.now();
  for (let i = 0; i < count; i++) {
    t = computeNextRun(rule, t);
    out.push(t);
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/schedule.ts test/schedule.test.ts
git commit -m "feat: 调度规则模块（cron/固定间隔/随机间隔）"
```

---

### Task 4: 加密与会话（src/server/crypto.ts）

**Files:**
- Create: `src/server/crypto.ts`
- Test: `test/crypto.test.ts`

**Interfaces:**
- Produces:
  - `encryptText(plain: string, secret: string): Promise<string>`（AES-GCM，输出 base64(iv+密文)）
  - `decryptText(enc: string, secret: string): Promise<string>`（密钥不符 throw）
  - `tokenFingerprint(token: string): string`（如 `****abcd`）
  - `createSessionToken(secret: string, now?: number): Promise<string>`（格式 `exp.sig`）
  - `verifySessionToken(token: string, secret: string, now?: number): Promise<boolean>`
  - `verifyPassword(input: string, actual: string): Promise<boolean>`（恒定时间）
  - `const SESSION_TTL_MS = 7 * 24 * 3600 * 1000`

- [ ] **Step 1: 写失败测试 test/crypto.test.ts**

```ts
import { describe, it, expect } from "vitest";
import {
  encryptText, decryptText, tokenFingerprint,
  createSessionToken, verifySessionToken, verifyPassword,
} from "../src/server/crypto";

describe("AES-GCM 文本加密", () => {
  it("加解密往返", async () => {
    const enc = await encryptText("ghp_abc123", "key1");
    expect(enc).not.toContain("ghp_abc123");
    expect(await decryptText(enc, "key1")).toBe("ghp_abc123");
  });
  it("错误密钥解密失败", async () => {
    const enc = await encryptText("ghp_abc123", "key1");
    await expect(decryptText(enc, "key2")).rejects.toThrow();
  });
  it("相同明文两次加密产生不同密文（随机 IV）", async () => {
    expect(await encryptText("x", "k")).not.toBe(await encryptText("x", "k"));
  });
});

describe("token 指纹", () => {
  it("只保留末 4 位", () => {
    expect(tokenFingerprint("ghp_" + "a".repeat(36) + "wxyz")).toBe("****wxyz");
  });
});

describe("会话令牌", () => {
  it("创建后可验证", async () => {
    const t = await createSessionToken("secret");
    expect(await verifySessionToken(t, "secret")).toBe(true);
  });
  it("过期后验证失败", async () => {
    const t = await createSessionToken("secret", 0);
    expect(await verifySessionToken(t, "secret", 8 * 24 * 3600 * 1000)).toBe(false);
  });
  it("密钥不同验证失败", async () => {
    const t = await createSessionToken("secret");
    expect(await verifySessionToken(t, "other")).toBe(false);
  });
  it("篡改令牌验证失败", async () => {
    const t = await createSessionToken("secret");
    expect(await verifySessionToken(t.slice(0, -2) + "xx", "secret")).toBe(false);
  });
});

describe("密码验证", () => {
  it("正确密码", async () => expect(await verifyPassword("abc", "abc")).toBe(true));
  it("错误密码", async () => expect(await verifyPassword("abc", "abd")).toBe(false));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 src/server/crypto.ts**

```ts
// AES-GCM 加密（存 PAT）+ HMAC-SHA256 无状态会话令牌 + 恒定时间密码比较。
// 全部使用 WebCrypto（Node 20+ 全局可用，Workers 原生支持）。

const te = new TextEncoder();

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", te.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptText(plain: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), te.encode(plain));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return b64encode(out);
}

export async function decryptText(enc: string, secret: string): Promise<string> {
  const raw = b64decode(enc);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) },
    await aesKey(secret),
    raw.slice(12),
  );
  return new TextDecoder().decode(pt);
}

export function tokenFingerprint(token: string): string {
  return `****${token.slice(-4)}`;
}

async function hmacKey(secret: string, domain: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", te.encode(`${domain}:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export async function createSessionToken(secret: string, now: number = Date.now()): Promise<string> {
  const exp = now + SESSION_TTL_MS;
  const key = await hmacKey(secret, "session");
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(String(exp)));
  return `${exp}.${b64encode(sig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export async function verifySessionToken(token: string, secret: string, now: number = Date.now()): Promise<boolean> {
  const [expStr, sigPart] = token.split(".");
  if (!expStr || !sigPart) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return false;
  const key = await hmacKey(secret, "session");
  let sig: Uint8Array;
  try {
    sig = b64decode(sigPart.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return false;
  }
  return crypto.subtle.verify("HMAC", key, sig, te.encode(expStr));
}

export async function verifyPassword(input: string, actual: string): Promise<boolean> {
  // 先各自 SHA-256 定长，再逐字节比较，避免时序与长度泄露
  const da = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(input)));
  const db = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(actual)));
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/crypto.ts test/crypto.test.ts
git commit -m "feat: AES-GCM加密与HMAC会话令牌"
```

---

### Task 5: GitHub API 客户端（src/server/github.ts）

**Files:**
- Create: `src/server/github.ts`
- Test: `test/github.test.ts`

**Interfaces:**
- Produces:
  - `type TriggerConfig = { repo: string; triggerType: "workflow_dispatch" | "repository_dispatch"; workflowId?: string | null; eventType?: string | null; ref?: string | null; inputsJson?: string | null }`
  - `type TriggerResult = { ok: true; httpStatus: number } | { ok: false; httpStatus: number; error: string }`
  - `triggerGithub(token, cfg, fetchFn?, timeoutMs?): Promise<TriggerResult>`（fetchFn 默认全局 fetch，可注入；成功=HTTP 204）
  - `verifyGithubToken(token, fetchFn?): Promise<{ ok: true; login: string } | { ok: false; error: string }>`

- [ ] **Step 1: 写失败测试 test/github.test.ts**

```ts
import { describe, it, expect, vi } from "vitest";
import { triggerGithub, verifyGithubToken } from "../src/server/github";

function res(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe("triggerGithub", () => {
  const wfCfg = {
    repo: "alice/repo1", triggerType: "workflow_dispatch" as const,
    workflowId: "run.yml", ref: "main", inputsJson: null,
  };

  it("204 视为成功", async () => {
    const fn = vi.fn(async () => res(204));
    const r = await triggerGithub("tok", wfCfg, fn as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, httpStatus: 204 });
  });
  it("workflow_dispatch 请求 URL 与 body 正确", async () => {
    const fn = vi.fn(async () => res(204));
    await triggerGithub("tok", { ...wfCfg, inputsJson: '{"foo":"bar"}' }, fn as unknown as typeof fetch);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/alice/repo1/actions/workflows/run.yml/dispatches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ ref: "main", inputs: { foo: "bar" } });
    expect(init.headers.Authorization).toBe("Bearer tok");
  });
  it("repository_dispatch 请求正确", async () => {
    const fn = vi.fn(async () => res(204));
    await triggerGithub("tok", {
      repo: "bob/repo2", triggerType: "repository_dispatch",
      eventType: "cron", inputsJson: '{"k":"v"}',
    }, fn as unknown as typeof fetch);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/bob/repo2/dispatches");
    expect(JSON.parse(init.body)).toEqual({ event_type: "cron", client_payload: { k: "v" } });
  });
  it("404 返回错误并带 GitHub 消息", async () => {
    const r = await triggerGithub("tok", wfCfg, (async () => res(404, { message: "Not Found" })) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.httpStatus).toBe(404);
      expect(r.error).toContain("Not Found");
    }
  });
  it("非法 inputs JSON 报错", async () => {
    const r = await triggerGithub("tok", { ...wfCfg, inputsJson: "not-json" }, (async () => res(204)) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("inputs");
  });
});

describe("verifyGithubToken", () => {
  it("有效 token 返回 login", async () => {
    const r = await verifyGithubToken("tok", (async () => res(200, { login: "alice" })) as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, login: "alice" });
  });
  it("401 返回错误", async () => {
    const r = await verifyGithubToken("bad", (async () => res(401)) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 src/server/github.ts**

```ts
export type TriggerConfig = {
  repo: string;
  triggerType: "workflow_dispatch" | "repository_dispatch";
  workflowId?: string | null;
  eventType?: string | null;
  ref?: string | null;
  inputsJson?: string | null;
};

export type TriggerResult = { ok: true; httpStatus: number } | { ok: false; httpStatus: number; error: string };

function parsePayloadJson(json?: string | null): Record<string, unknown> {
  if (!json || !json.trim()) return {};
  const v = JSON.parse(json);
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("inputs/payload 必须是 JSON 对象");
  return v as Record<string, unknown>;
}

const HEADERS = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "User-Agent": "cronjob-scheduler",
});

export async function triggerGithub(
  token: string,
  cfg: TriggerConfig,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<TriggerResult> {
  let url: string;
  let body: Record<string, unknown>;
  try {
    if (cfg.triggerType === "workflow_dispatch") {
      if (!cfg.workflowId) return { ok: false, httpStatus: 0, error: "缺少 workflow 文件名" };
      url = `https://api.github.com/repos/${cfg.repo}/actions/workflows/${cfg.workflowId}/dispatches`;
      body = { ref: cfg.ref || "main", inputs: parsePayloadJson(cfg.inputsJson) };
    } else {
      url = `https://api.github.com/repos/${cfg.repo}/dispatches`;
      body = { event_type: cfg.eventType || "cron", client_payload: parsePayloadJson(cfg.inputsJson) };
    }
  } catch (e) {
    return { ok: false, httpStatus: 0, error: (e as Error).message };
  }
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: HEADERS(token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 204) return { ok: true, httpStatus: 204 };
    let msg = await res.text();
    try {
      msg = (JSON.parse(msg) as { message?: string }).message ?? msg;
    } catch { /* 保留原文 */ }
    return { ok: false, httpStatus: res.status, error: `GitHub API ${res.status}: ${msg}`.slice(0, 500) };
  } catch (e) {
    return { ok: false, httpStatus: 0, error: `请求失败: ${(e as Error).message}`.slice(0, 500) };
  }
}

export async function verifyGithubToken(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; login: string } | { ok: false; error: string }> {
  try {
    const res = await fetchFn("https://api.github.com/user", {
      headers: HEADERS(token),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: `GitHub API ${res.status}` };
    const data = (await res.json()) as { login?: string };
    return { ok: true, login: data.login ?? "" };
  } catch (e) {
    return { ok: false, error: `请求失败: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/github.ts test/github.test.ts
git commit -m "feat: GitHub API客户端(触发与token验证)"
```

---

### Task 6: 类型定义、FakeD1 与调度核心（src/server/types.ts、scheduler.ts）

**Files:**
- Create: `src/server/types.ts`, `src/server/scheduler.ts`, `test/helpers/fake-d1.ts`
- Test: `test/scheduler.test.ts`

**Interfaces:**
- Consumes: `computeNextRun`、`validateSchedule`（Task 3）、`decryptText`（Task 4）、`triggerGithub`（Task 5）
- Produces:
  - `type Env = { DB: D1Database; ASSETS: Fetcher; ADMIN_PASSWORD: string; TOKEN_ENC_KEY: string }`（src/server/types.ts，另含 `JobRow`、`AccountRow` 类型）
  - `triggerJobOnce(env: Env, jobId: number, source: "schedule" | "manual"): Promise<TriggerOutcome | { notFound: true }>`
  - `runDueJobs(env: Env, now?: number): Promise<{ triggered: number; failed: number }>`
  - `type TriggerOutcome = { ok: boolean; httpStatus: number; error?: string }`
  - FakeD1（测试辅助，覆盖本计划用到的全部 SQL 语句）

- [ ] **Step 1: 创建 src/server/types.ts**

```ts
export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  TOKEN_ENC_KEY: string;
};

export type AccountRow = {
  id: number;
  name: string;
  github_login: string | null;
  token_encrypted: string;
  token_fingerprint: string;
  status: string;
  last_verified_at: number | null;
  created_at: number;
  updated_at: number;
};

export type JobRow = {
  id: number;
  name: string;
  account_id: number;
  repo: string;
  trigger_type: "workflow_dispatch" | "repository_dispatch";
  workflow_id: string | null;
  event_type: string | null;
  ref: string | null;
  inputs_json: string | null;
  schedule_json: string;
  enabled: number;
  next_run_at: number;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
};
```

- [ ] **Step 2: 创建测试辅助 test/helpers/fake-d1.ts**

覆盖本计划全部 SQL（按正则匹配，注册顺序即匹配顺序）。字段名与 `src/schema.sql` 一一致。

```ts
// 测试用内存 D1：只支持本项目用到的 SQL 语句（正则匹配）。
type Row = Record<string, unknown>;

export class FakeD1 {
  jobs: Row[] = [];
  accounts: Row[] = [];
  runs: Row[] = [];
  lastRowId = 0;

  prepare(sql: string) {
    return new FakeStmt(this, sql);
  }
}

class FakeStmt {
  private params: unknown[] = [];
  constructor(private db: FakeD1, private sql: string) {}
  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }
  async first<T>(): Promise<T | null> {
    const rows = this.exec();
    return (rows.length ? (rows[0] as T) : null);
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.exec() as T[] };
  }
  async run(): Promise<{ meta: { changes: number; last_row_id: number } }> {
    const r = this.exec();
    const changes = typeof r === "number" ? r : r.length;
    return { meta: { changes, last_row_id: this.db.lastRowId } };
  }

  private exec(): Row[] | number {
    const s = this.sql.replace(/\s+/g, " ").trim();
    const p = this.params as Array<Record<string, unknown> & number>;
    const db = this.db;
    const now = 0; // 不使用

    // ---- scheduler ----
    if (/SELECT \* FROM jobs WHERE enabled=1 AND next_run_at<=\?/.test(s))
      return db.jobs
        .filter((j) => j.enabled === 1 && (j.next_run_at as number) <= p[0])
        .sort((a, b) => (a.next_run_at as number) - (b.next_run_at as number))
        .slice(0, 50);
    if (/UPDATE jobs SET next_run_at=\?, updated_at=\? WHERE id=\? AND next_run_at=\? AND enabled=1/.test(s)) {
      let changes = 0;
      for (const j of db.jobs)
        if (j.id === p[2] && j.next_run_at === p[3] && j.enabled === 1) {
          j.next_run_at = p[0]; j.updated_at = p[1]; changes++;
        }
      return changes;
    }
    if (/UPDATE jobs SET last_run_at=\? WHERE id=\?/.test(s)) {
      for (const j of db.jobs) if (j.id === p[1]) j.last_run_at = p[0];
      return 1;
    }
    if (/UPDATE accounts SET status='invalid', updated_at=\? WHERE id=\?/.test(s)) {
      for (const a of db.accounts) if (a.id === p[1]) { a.status = "invalid"; a.updated_at = p[0]; }
      return 1;
    }
    if (/DELETE FROM runs WHERE triggered_at < \?/.test(s)) {
      const before = db.runs.length;
      db.runs = db.runs.filter((r) => (r.triggered_at as number) >= p[0]);
      return before - db.runs.length;
    }

    // ---- accounts 路由 ----
    if (/SELECT \* FROM accounts ORDER BY id/.test(s)) return [...db.accounts].sort((a, b) => (a.id as number) - (b.id as number));
    if (/INSERT INTO accounts/.test(s)) {
      db.lastRowId = ++db.accounts.length ? db.accounts.length : 0;
      db.accounts.push({
        id: db.lastRowId, name: p[0], github_login: p[1], token_encrypted: p[2],
        token_fingerprint: p[3], status: p[4], last_verified_at: p[5], created_at: p[6], updated_at: p[7],
      });
      return 1;
    }
    if (/UPDATE accounts SET name=\?, token_encrypted=\?, token_fingerprint=\?, updated_at=\? WHERE id=\?/.test(s)) {
      for (const a of db.accounts) if (a.id === p[4]) {
        a.name = p[0]; a.token_encrypted = p[1]; a.token_fingerprint = p[2]; a.updated_at = p[3];
      }
      return 1;
    }
    if (/UPDATE accounts SET github_login=\?, status=\?, last_verified_at=\?, updated_at=\? WHERE id=\?/.test(s)) {
      for (const a of db.accounts) if (a.id === p[4]) {
        a.github_login = p[0]; a.status = p[1]; a.last_verified_at = p[2]; a.updated_at = p[3];
      }
      return 1;
    }
    if (/UPDATE accounts SET name=\?, updated_at=\? WHERE id=\?/.test(s)) {
      for (const a of db.accounts) if (a.id === p[2]) { a.name = p[0]; a.updated_at = p[1]; }
      return 1;
    }
    if (/DELETE FROM runs WHERE job_id IN \(SELECT id FROM jobs WHERE account_id=\?\)/.test(s)) {
      const jobIds = db.jobs.filter((j) => j.account_id === p[0]).map((j) => j.id);
      const before = db.runs.length;
      db.runs = db.runs.filter((r) => !jobIds.includes(r.job_id));
      return before - db.runs.length;
    }
    if (/DELETE FROM jobs WHERE account_id=\?/.test(s)) {
      const before = db.jobs.length;
      db.jobs = db.jobs.filter((j) => j.account_id !== p[0]);
      return before - db.jobs.length;
    }
    if (/DELETE FROM accounts WHERE id=\?/.test(s)) {
      const before = db.accounts.length;
      db.accounts = db.accounts.filter((a) => a.id !== p[0]);
      return before - db.accounts.length;
    }

    // ---- jobs 路由 ----
    if (/SELECT j\.\*, a\.name AS account_name FROM jobs j LEFT JOIN accounts a/.test(s))
      return [...db.jobs]
        .sort((a, b) => (b.id as number) - (a.id as number))
        .map((j) => ({ ...j, account_name: db.accounts.find((a) => a.id === j.account_id)?.name ?? null }));
    if (/INSERT INTO jobs/.test(s)) {
      db.lastRowId = db.jobs.length + 1;
      db.jobs.push({
        id: db.lastRowId, name: p[0], account_id: p[1], repo: p[2], trigger_type: p[3],
        workflow_id: p[4], event_type: p[5], ref: p[6], inputs_json: p[7], schedule_json: p[8],
        enabled: p[9], next_run_at: p[10], created_at: p[11], updated_at: p[12], last_run_at: null,
      });
      return 1;
    }
    if (/UPDATE jobs SET name=\?, account_id=\?, repo=\?, trigger_type=\?, workflow_id=\?, event_type=\?, ref=\?, inputs_json=\?, schedule_json=\?, enabled=\?, next_run_at=\?, updated_at=\? WHERE id=\?/.test(s)) {
      for (const j of db.jobs) if (j.id === p[12]) {
        [j.name, j.account_id, j.repo, j.trigger_type, j.workflow_id, j.event_type, j.ref,
         j.inputs_json, j.schedule_json, j.enabled, j.next_run_at, j.updated_at] = p;
      }
      return 1;
    }
    if (/UPDATE jobs SET enabled=\?, next_run_at=\?, updated_at=\? WHERE id=\?/.test(s)) {
      for (const j of db.jobs) if (j.id === p[3]) { j.enabled = p[0]; j.next_run_at = p[1]; j.updated_at = p[2]; }
      return 1;
    }
    if (/DELETE FROM runs WHERE job_id=\?/.test(s)) {
      const before = db.runs.length;
      db.runs = db.runs.filter((r) => r.job_id !== p[0]);
      return before - db.runs.length;
    }
    if (/DELETE FROM jobs WHERE id=\?/.test(s)) {
      const before = db.jobs.length;
      db.jobs = db.jobs.filter((j) => j.id !== p[0]);
      return before - db.jobs.length;
    }
    if (/SELECT id FROM accounts WHERE id=\?/.test(s)) return db.accounts.filter((a) => a.id === p[0]).map((a) => ({ id: a.id }));

    // ---- runs 路由 ----
    if (/SELECT COUNT\(\*\) AS cnt FROM runs/.test(s)) {
      const rows = this.filterRuns();
      return [{ cnt: rows.length }];
    }
    if (/SELECT r\.\*, j\.name AS job_name FROM runs r/.test(s)) {
      const rows = this.filterRuns()
        .sort((a, b) => (b.triggered_at as number) - (a.triggered_at as number))
        .slice(p[p.length - 2] as number, (p[p.length - 2] as number) + (p[p.length - 1] as number));
      return rows.map((r) => ({ ...r, job_name: db.jobs.find((j) => j.id === r.job_id)?.name ?? null }));
    }

    // ---- stats ----
    if (/SELECT \(SELECT COUNT\(\*\) FROM accounts\) AS accounts/.test(s)) {
      // 绑定顺序 [dayStart, now-24h]
      return [{
        accounts: db.accounts.length,
        total_jobs: db.jobs.length,
        enabled_jobs: db.jobs.filter((j) => j.enabled === 1).length,
        today_runs: db.runs.filter((r) => (r.triggered_at as number) >= p[0]).length,
        failed_24h: db.runs.filter((r) => (r.triggered_at as number) >= p[1] && r.status === "failed").length,
      }];
    }

    throw new Error(`FakeD1 不支持的 SQL: ${s}`);
  }

  private filterRuns(): Row[] {
    const s = this.sql.replace(/\s+/g, " ").trim();
    const db = this.db;
    if (/WHERE r\.job_id=\?/.test(s)) return db.runs.filter((r) => r.job_id === this.params[0]);
    return [...db.runs];
  }
}
```

注意：`INSERT INTO accounts` 分支里 `++db.accounts.length ? ... : 0` 是笔误风险写法，实现时直接写：

```ts
db.lastRowId = db.accounts.length + 1;
db.accounts.push({ id: db.lastRowId, ... });
```

- [ ] **Step 3: 写失败测试 test/scheduler.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runDueJobs, triggerJobOnce } from "../src/server/scheduler";
import { encryptText } from "../src/server/crypto";
import { FakeD1 } from "./helpers/fake-d1";
import type { Env } from "../src/server/types";

const NOW = 1_800_000_000_000; // 固定"当前时间"

async function makeEnv(): Promise<{ env: Env; db: FakeD1 }> {
  const db = new FakeD1();
  const env = { DB: db as unknown as D1Database, ASSETS: null as never, ADMIN_PASSWORD: "pw", TOKEN_ENC_KEY: "enckey" };
  db.accounts.push({
    id: 1, name: "acc1", github_login: "alice",
    token_encrypted: await encryptText("ghp_test_token", "enckey"),
    token_fingerprint: "****oken", status: "ok", last_verified_at: NOW,
    created_at: NOW, updated_at: NOW,
  });
  return { env, db };
}

function addJob(db: FakeD1, over: Record<string, unknown> = {}) {
  db.jobs.push({
    id: 1, name: "job1", account_id: 1, repo: "alice/repo1",
    trigger_type: "workflow_dispatch", workflow_id: "run.yml", event_type: null,
    ref: "main", inputs_json: null,
    schedule_json: JSON.stringify({ type: "interval", mode: "fixed", value: 45, unit: "m" }),
    enabled: 1, next_run_at: NOW - 1_000, last_run_at: null, created_at: NOW, updated_at: NOW,
    ...over,
  });
}

describe("runDueJobs", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 }))));
  afterEach(() => vi.unstubAllGlobals());

  it("到期任务被触发并写回下次时间与运行记录", async () => {
    const { env, db } = await makeEnv();
    addJob(db);
    const r = await runDueJobs(env, NOW);
    expect(r).toEqual({ triggered: 1, failed: 0 });
    expect(db.jobs[0].next_run_at).toBe(NOW - 1_000 + 45 * 60_000); // 基于原计划时间
    expect(db.jobs[0].last_run_at).toBe(NOW);
    expect(db.runs).toHaveLength(1);
    expect(db.runs[0].status).toBe("success");
    expect(db.runs[0].source).toBe("schedule");
  });

  it("未到期任务不触发", async () => {
    const { env, db } = await makeEnv();
    addJob(db, { next_run_at: NOW + 999_999 });
    const r = await runDueJobs(env, NOW);
    expect(r).toEqual({ triggered: 0, failed: 0 });
    expect(db.runs).toHaveLength(0);
  });

  it("停用任务不触发", async () => {
    const { env, db } = await makeEnv();
    addJob(db, { enabled: 0 });
    const r = await runDueJobs(env, NOW);
    expect(r).toEqual({ triggered: 0, failed: 0 });
  });

  it("GitHub 401 时账号被标记 invalid 且记失败", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })));
    const { env, db } = await makeEnv();
    addJob(db);
    const r = await runDueJobs(env, NOW);
    expect(r.failed).toBe(1);
    expect(db.accounts[0].status).toBe("invalid");
    expect(db.runs[0].status).toBe("failed");
    expect(db.runs[0].error_message).toContain("401");
  });

  it("乐观锁：任务被其他实例处理过则跳过", async () => {
    const { env, db } = await makeEnv();
    addJob(db, { next_run_at: NOW - 1_000 });
    // 模拟另一实例已把 next_run_at 推后：把 UPDATE 的条件值改掉
    const job = db.jobs[0] as Record<string, unknown>;
    const origPrepare = db.prepare.bind(db);
    let bumped = false;
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (/WHERE id=\? AND next_run_at=\? AND enabled=1/.test(sql) && !bumped) {
        bumped = true;
        job.next_run_at = NOW + 999_999; // 在 UPDATE 执行前被并发修改
      }
      return stmt;
    };
    const r = await runDueJobs(env, NOW);
    expect(r).toEqual({ triggered: 0, failed: 0 });
    expect(db.runs).toHaveLength(0);
  });

  it("清理 90 天前的运行记录", async () => {
    const { env, db } = await makeEnv();
    db.runs.push({ id: 1, job_id: 1, triggered_at: NOW - 91 * 24 * 3600 * 1000, source: "schedule", status: "success", http_status: 204, error_message: null });
    db.runs.push({ id: 2, job_id: 1, triggered_at: NOW - 10 * 24 * 3600 * 1000, source: "schedule", status: "success", http_status: 204, error_message: null });
    await runDueJobs(env, NOW);
    expect(db.runs).toHaveLength(1);
    expect((db.runs[0] as Record<string, unknown>).id).toBe(2);
  });
});

describe("triggerJobOnce", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 }))));
  afterEach(() => vi.unstubAllGlobals());

  it("手动触发记录 source=manual 且不改 next_run_at", async () => {
    const { env, db } = await makeEnv();
    addJob(db, { next_run_at: NOW + 500_000 });
    const r = await triggerJobOnce(env, 1, "manual");
    expect(r.ok).toBe(true);
    expect(db.runs[0].source).toBe("manual");
    expect(db.jobs[0].next_run_at).toBe(NOW + 500_000);
  });

  it("任务不存在返回 notFound", async () => {
    const { env } = await makeEnv();
    const r = await triggerJobOnce(env, 99, "manual");
    expect(r).toEqual({ notFound: true });
  });
});
```

- [ ] **Step 4: 运行确认失败**

Run: `npm test`
Expected: FAIL（scheduler 模块不存在）

- [ ] **Step 5: 实现 src/server/scheduler.ts**

```ts
import { computeNextRun, validateSchedule } from "./schedule";
import { decryptText } from "./crypto";
import { triggerGithub } from "./github";
import type { AccountRow, Env, JobRow } from "./types";

const RUN_RETENTION_MS = 90 * 24 * 3600 * 1000;

export type TriggerOutcome = { ok: boolean; httpStatus: number; error?: string };

async function recordRun(env: Env, jobId: number, source: "schedule" | "manual", status: string, httpStatus: number, error: string | null) {
  await env.DB.prepare(
    "INSERT INTO runs (job_id, triggered_at, source, status, http_status, error_message) VALUES (?,?,?,?,?,?)",
  )
    .bind(jobId, Date.now(), source, status, httpStatus, error)
    .run();
}

export async function dispatchJob(env: Env, job: JobRow, account: AccountRow, source: "schedule" | "manual"): Promise<TriggerOutcome> {
  let token: string;
  try {
    token = await decryptText(account.token_encrypted, env.TOKEN_ENC_KEY);
  } catch {
    const msg = "token 解密失败（TOKEN_ENC_KEY 是否变更？）";
    await recordRun(env, job.id, source, "failed", 0, msg);
    return { ok: false, httpStatus: 0, error: msg };
  }
  const result = await triggerGithub(token, {
    repo: job.repo,
    triggerType: job.trigger_type,
    workflowId: job.workflow_id,
    eventType: job.event_type,
    ref: job.ref,
    inputsJson: job.inputs_json,
  });
  await recordRun(env, job.id, source, result.ok ? "success" : "failed", result.httpStatus, result.ok ? null : result.error);
  if (!result.ok && result.httpStatus === 401) {
    await env.DB.prepare("UPDATE accounts SET status='invalid', updated_at=? WHERE id=?")
      .bind(Date.now(), account.id)
      .run();
  }
  return { ok: result.ok, httpStatus: result.httpStatus, error: result.ok ? undefined : result.error };
}

export async function triggerJobOnce(env: Env, jobId: number, source: "schedule" | "manual"): Promise<TriggerOutcome | { notFound: true }> {
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(jobId).first<JobRow>();
  if (!job) return { notFound: true };
  const account = await env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(job.account_id).first<AccountRow>();
  if (!account) {
    await recordRun(env, job.id, source, "failed", 0, "账号不存在");
    return { ok: false, httpStatus: 0, error: "账号不存在" };
  }
  return dispatchJob(env, job, account, source);
}

export async function runDueJobs(env: Env, now: number = Date.now()): Promise<{ triggered: number; failed: number }> {
  const due = await env.DB.prepare(
    "SELECT * FROM jobs WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at ASC LIMIT 50",
  )
    .bind(now)
    .all<JobRow>();

  let triggered = 0;
  let failed = 0;
  for (const job of due.results ?? []) {
    const v = validateSchedule(JSON.parse(job.schedule_json));
    if (!v.ok) continue; // 调度规则损坏：跳过（不发触发，也不推进时间）
    // 基于原计划时间累加，避免累积漂移
    const newNext = computeNextRun(v.rule, job.next_run_at);
    const claim = await env.DB.prepare(
      "UPDATE jobs SET next_run_at=?, updated_at=? WHERE id=? AND next_run_at=? AND enabled=1",
    )
      .bind(newNext, now, job.id, job.next_run_at)
      .run();
    if ((claim.meta.changes ?? 0) !== 1) continue; // 已被并发执行实例处理

    const account = await env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(job.account_id).first<AccountRow>();
    if (!account) {
      await recordRun(env, job.id, "schedule", "failed", 0, "账号不存在");
      failed++;
      continue;
    }
    const result = await dispatchJob(env, job, account, "schedule");
    if (result.ok) triggered++;
    else failed++;
    await env.DB.prepare("UPDATE jobs SET last_run_at=? WHERE id=?").bind(now, job.id).run();
  }

  await env.DB.prepare("DELETE FROM runs WHERE triggered_at < ?").bind(now - RUN_RETENTION_MS).run();
  return { triggered, failed };
}
```

注意：`dispatchJob` 内 `recordRun` 的时间戳用 `Date.now()`（真实触发时刻），而 `runDueJobs` 的 `last_run_at`/`next_run_at` 用传入的 `now` 保证测试确定性与抗漂移。

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/types.ts src/server/scheduler.ts test/helpers/fake-d1.ts test/scheduler.test.ts
git commit -m "feat: 调度核心(到期扫描/乐观锁/触发记录)"
```

---

### Task 7: 认证路由与会话中间件

**Files:**
- Create: `src/server/routes/auth.ts`, `src/server/middleware.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`、`createSessionToken`、`verifySessionToken`（Task 4）
- Produces:
  - `authRoutes`：`POST /login`（body `{password}`，成功 Set-Cookie `session`）、`POST /logout`、`GET /me`
  - `requireAuth`（Hono middleware，src/server/middleware.ts，Task 11 在 worker.ts 使用）
  - `_resetLoginRateLimit()`（仅测试用）

- [ ] **Step 1: 写失败测试 test/auth.test.ts**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import authRoutes, { _resetLoginRateLimit } from "../src/server/routes/auth";

const env = { ADMIN_PASSWORD: "pw123", TOKEN_ENC_KEY: "k" };

function req(path: string, init?: RequestInit) {
  return authRoutes.request(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
  });
}

describe("auth 路由", () => {
  beforeEach(() => _resetLoginRateLimit());

  it("正确密码登录成功并种下 Cookie", async () => {
    const res = await req("/login", { method: "POST", body: JSON.stringify({ password: "pw123" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("session=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await res.json()).toEqual({ ok: true, data: null });
  });
  it("错误密码返回 401", async () => {
    const res = await req("/login", { method: "POST", body: JSON.stringify({ password: "wrong" }) });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
  it("连续 5 次失败后锁定 10 分钟", async () => {
    for (let i = 0; i < 5; i++) await req("/login", { method: "POST", body: JSON.stringify({ password: "wrong" }) });
    const res = await req("/login", { method: "POST", body: JSON.stringify({ password: "pw123" }) });
    expect(res.status).toBe(429);
  });
  it("logout 清除 Cookie", async () => {
    const res = await req("/logout", { method: "POST" });
    expect(res.headers.get("set-cookie")).toContain("session=");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("me 带有效会话返回 200，否则 401", async () => {
    const login = await req("/login", { method: "POST", body: JSON.stringify({ password: "pw123" }) });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const ok = await req("/me", { headers: { Cookie: cookie } });
    expect(ok.status).toBe(200);
    const bad = await req("/me", { headers: { Cookie: "session=123.abc" } });
    expect(bad.status).toBe(401);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 src/server/routes/auth.ts**

```ts
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createSessionToken, verifyPassword, verifySessionToken } from "../crypto";
import type { Env } from "../types";

// 内存级登录限速：连续错 5 次锁 10 分钟（单管理密码场景够用；
// Worker 实例重启会清零，属可接受的折衷）
let fails = 0;
let lockedUntil = 0;
export function _resetLoginRateLimit() {
  fails = 0;
  lockedUntil = 0;
}

const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post("/login", async (c) => {
  if (Date.now() < lockedUntil) {
    return c.json({ ok: false, error: "尝试次数过多，请 10 分钟后再试" }, 429);
  }
  let password = "";
  try {
    const body = await c.req.json<{ password?: unknown }>();
    if (typeof body.password === "string") password = body.password;
  } catch { /* 视为空密码 */ }
  if (!password || !(await verifyPassword(password, c.env.ADMIN_PASSWORD))) {
    fails++;
    if (fails >= 5) {
      lockedUntil = Date.now() + 10 * 60_000;
      fails = 0;
    }
    return c.json({ ok: false, error: "密码错误" }, 401);
  }
  fails = 0;
  const token = await createSessionToken(c.env.ADMIN_PASSWORD);
  setCookie(c, "session", token, {
    httpOnly: true,
    secure: true, // localhost 下现代浏览器同样接受 Secure Cookie
    sameSite: "Strict",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
  return c.json({ ok: true, data: null });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true, data: null });
});

authRoutes.get("/me", async (c) => {
  const token = getCookie(c, "session");
  if (token && (await verifySessionToken(token, c.env.ADMIN_PASSWORD))) {
    return c.json({ ok: true, data: null });
  }
  return c.json({ ok: false, error: "未登录" }, 401);
});

export default authRoutes;
```

- [ ] **Step 4: 实现 src/server/middleware.ts**

```ts
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verifySessionToken } from "./crypto";
import type { Env } from "./types";

// 挂载在 /api/*（auth 路由除外），校验签名会话 Cookie
export const requireAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const token = getCookie(c, "session");
  if (!token || !(await verifySessionToken(token, c.env.ADMIN_PASSWORD))) {
    return c.json({ ok: false, error: "未登录" }, 401);
  }
  await next();
});
```

注意：`deleteCookie` 的 `set-cookie` 头是否包含 `Max-Age=0` 取决于 hono 版本；若测试失败，把断言改为 `toContain("session=")` 且 `toContain("1970")` 或仅 `toContain("session=")`（以实际 hono 实现为准，删除语义即可）。

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/auth.ts src/server/middleware.ts test/auth.test.ts
git commit -m "feat: 登录认证(密码会话/限速)与requireAuth中间件"
```

---

### Task 8: 账号管理路由（src/server/routes/accounts.ts）

**Files:**
- Create: `src/server/routes/accounts.ts`
- Test: `test/accounts.test.ts`

**Interfaces:**
- Consumes: `encryptText`、`decryptText`、`tokenFingerprint`（Task 4）、`verifyGithubToken`（Task 5）、FakeD1（Task 6）
- Produces: `accountRoutes`（子应用，挂载于 `/api/accounts`）：
  - `GET /` → 账号列表（不含 token 明文/密文，只含 `id,name,github_login,token_fingerprint,status,last_verified_at`）
  - `POST /` body `{name, token, verify?}` → 201 或 400
  - `POST /:id/verify`
  - `PUT /:id` body `{name?, token?, verify?}`
  - `DELETE /:id`（级联删除任务与运行记录）

- [ ] **Step 1: 写失败测试 test/accounts.test.ts**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import accountRoutes from "../src/server/routes/accounts";
import { encryptText } from "../src/server/crypto";
import { FakeD1 } from "./helpers/fake-d1";
import type { Env } from "../src/server/types";

let db: FakeD1;
let env: Env;
beforeEach(async () => {
  db = new FakeD1();
  env = { DB: db as unknown as D1Database, ASSETS: null as never, ADMIN_PASSWORD: "pw", TOKEN_ENC_KEY: "enckey" };
  db.accounts.push({
    id: 1, name: "旧账号", github_login: "alice",
    token_encrypted: await encryptText("ghp_existing_token_xxxx", "enckey"),
    token_fingerprint: "****xxxx", status: "ok", last_verified_at: 1,
    created_at: 1, updated_at: 1,
  });
});

function req(path: string, init?: RequestInit) {
  return accountRoutes.request(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
  }, env);
}

describe("账号路由", () => {
  it("列表不泄露 token", async () => {
    const res = await req("/");
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(JSON.stringify(json.data)).not.toContain("ghp_");
    expect(json.data[0]).toMatchObject({ id: 1, name: "旧账号", token_fingerprint: "****xxxx" });
  });

  it("新增账号并验证成功", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ login: "bob" }), { status: 200 })));
    const res = await req("/", { method: "POST", body: JSON.stringify({ name: "新账号", token: "ghp_new_token_1234567890", verify: true }) });
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.data).toMatchObject({ name: "新账号", github_login: "bob", status: "ok" });
    expect(db.accounts[1].token_encrypted).not.toContain("ghp_new");
    vi.unstubAllGlobals();
  });

  it("验证失败时拒绝保存", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    const res = await req("/", { method: "POST", body: JSON.stringify({ name: "x", token: "ghp_bad_token_1234567890", verify: true }) });
    expect(res.status).toBe(400);
    expect(db.accounts).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("token 太短拒绝", async () => {
    const res = await req("/", { method: "POST", body: JSON.stringify({ name: "x", token: "short" }) });
    expect(res.status).toBe(400);
  });

  it("重新验证解密存量 token 并更新状态", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ login: "alice2" }), { status: 200 })));
    const res = await req("/1/verify", { method: "POST" });
    const json = await res.json();
    expect(json.data.status).toBe("ok");
    expect(db.accounts[0].github_login).toBe("alice2");
    vi.unstubAllGlobals();
  });

  it("更新名称与换 token", async () => {
    const res = await req("/1", { method: "PUT", body: JSON.stringify({ name: "改名" }) });
    expect(db.accounts[0].name).toBe("改名");
    await req("/1", { method: "PUT", body: JSON.stringify({ token: "ghp_replaced_token_abcdefgh" }) });
    expect(db.accounts[0].token_fingerprint).toBe("****efgh");
    expect(db.accounts[0].token_encrypted).not.toContain("ghp_replaced");
  });

  it("删除账号级联删除任务与运行记录", async () => {
    db.jobs.push({ id: 7, name: "j", account_id: 1, repo: "a/b", trigger_type: "workflow_dispatch", workflow_id: "x.yml", event_type: null, ref: "main", inputs_json: null, schedule_json: "{}", enabled: 1, next_run_at: 0, last_run_at: null, created_at: 0, updated_at: 0 });
    db.runs.push({ id: 1, job_id: 7, triggered_at: 1, source: "manual", status: "success", http_status: 204, error_message: null });
    const res = await req("/1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(db.accounts).toHaveLength(0);
    expect(db.jobs).toHaveLength(0);
    expect(db.runs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 src/server/routes/accounts.ts**

```ts
import { Hono } from "hono";
import { encryptText, decryptText, tokenFingerprint } from "../crypto";
import { verifyGithubToken } from "../github";
import type { AccountRow, Env } from "../types";

const accountRoutes = new Hono<{ Bindings: Env }>();

type PublicAccount = Omit<AccountRow, "token_encrypted" | "created_at" | "updated_at">;

function publicView(a: AccountRow): PublicAccount {
  return {
    id: a.id,
    name: a.name,
    github_login: a.github_login,
    token_fingerprint: a.token_fingerprint,
    status: a.status,
    last_verified_at: a.last_verified_at,
  };
}

accountRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM accounts ORDER BY id").all<AccountRow>();
  return c.json({ ok: true, data: (rows.results ?? []).map(publicView) });
});

accountRoutes.post("/", async (c) => {
  const body = await c.req.json<{ name?: unknown; token?: unknown; verify?: unknown }>().catch(() => ({}) as never);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!name || name.length > 100) return c.json({ ok: false, error: "备注名必填（≤100 字）" }, 400);
  if (token.length < 20) return c.json({ ok: false, error: "token 长度太短，请粘贴完整的 PAT" }, 400);

  let github_login: string | null = null;
  let status = "unknown";
  let last_verified_at: number | null = null;
  if (body.verify === true) {
    const v = await verifyGithubToken(token);
    if (!v.ok) return c.json({ ok: false, error: `Token 验证失败：${v.error}` }, 400);
    github_login = v.login;
    status = "ok";
    last_verified_at = Date.now();
  }

  const token_encrypted = await encryptText(token, c.env.TOKEN_ENC_KEY);
  const now = Date.now();
  const r = await c.env.DB.prepare(
    "INSERT INTO accounts (name, github_login, token_encrypted, token_fingerprint, status, last_verified_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
  )
    .bind(name, github_login, token_encrypted, tokenFingerprint(token), status, last_verified_at, now, now)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(r.meta.last_row_id).first<AccountRow>();
  return c.json({ ok: true, data: row ? publicView(row) : null }, 201);
});

accountRoutes.post("/:id/verify", async (c) => {
  const account = await c.env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(Number(c.req.param("id"))).first<AccountRow>();
  if (!account) return c.json({ ok: false, error: "账号不存在" }, 404);
  const token = await decryptText(account.token_encrypted, c.env.TOKEN_ENC_KEY).catch(() => "");
  if (!token) return c.json({ ok: false, error: "token 解密失败" }, 500);
  const v = await verifyGithubToken(token);
  const status = v.ok ? "ok" : "invalid";
  const now = Date.now();
  await c.env.DB.prepare(
    "UPDATE accounts SET github_login=?, status=?, last_verified_at=?, updated_at=? WHERE id=?",
  )
    .bind(v.ok ? v.login : account.github_login, status, now, now, account.id)
    .run();
  if (!v.ok) return c.json({ ok: false, error: `Token 验证失败：${v.error}` }, 400);
  return c.json({ ok: true, data: { status, github_login: v.login } });
});

accountRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const account = await c.env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(id).first<AccountRow>();
  if (!account) return c.json({ ok: false, error: "账号不存在" }, 404);
  const body = await c.req.json<{ name?: unknown; token?: unknown; verify?: unknown }>().catch(() => ({}) as never);

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : account.name;
  const newToken = typeof body.token === "string" && body.token.trim() ? body.token.trim() : null;
  if (newToken && newToken.length < 20) return c.json({ ok: false, error: "token 长度太短" }, 400);

  const now = Date.now();
  if (newToken) {
    const token_encrypted = await encryptText(newToken, c.env.TOKEN_ENC_KEY);
    await c.env.DB.prepare(
      "UPDATE accounts SET name=?, token_encrypted=?, token_fingerprint=?, updated_at=? WHERE id=?",
    )
      .bind(name, token_encrypted, tokenFingerprint(newToken), now, id)
      .run();
    if (body.verify === true) {
      const v = await verifyGithubToken(newToken);
      await c.env.DB.prepare(
        "UPDATE accounts SET github_login=?, status=?, last_verified_at=?, updated_at=? WHERE id=?",
      ).bind(v.ok ? v.login : null, v.ok ? "ok" : "invalid", now, now, id).run();
    }
  } else {
    await c.env.DB.prepare("UPDATE accounts SET name=?, updated_at=? WHERE id=?").bind(name, now, id).run();
  }
  const row = await c.env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(id).first<AccountRow>();
  return c.json({ ok: true, data: row ? publicView(row) : null });
});

accountRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM runs WHERE job_id IN (SELECT id FROM jobs WHERE account_id=?)").bind(id).run();
  await c.env.DB.prepare("DELETE FROM jobs WHERE account_id=?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM accounts WHERE id=?").bind(id).run();
  return c.json({ ok: true, data: null });
});

export default accountRoutes;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/accounts.ts test/accounts.test.ts
git commit -m "feat: 账号管理路由(加密存储/在线验证/级联删除)"
```

---

### Task 9: 任务管理路由（src/server/routes/jobs.ts）

**Files:**
- Create: `src/server/routes/jobs.ts`
- Test: `test/jobs.test.ts`

**Interfaces:**
- Consumes: `validateSchedule`、`computeNextRun`、`ScheduleRule`（Task 3）、`triggerJobOnce`（Task 6）、FakeD1
- Produces: `jobRoutes`（挂载于 `/api/jobs`）：
  - `GET /` → 列表（`job.*` + `account_name`，按 id 倒序）
  - `POST /` body `{name, account_id, repo, trigger_type, workflow_id?, event_type?, ref?, inputs_json?, schedule, enabled?}`
  - `PUT /:id`（改调度后 next_run_at 从当前时间重算）
  - `POST /:id/toggle`（重新启用时 next_run_at 重算）
  - `POST /:id/trigger`（手动触发，source=manual）
  - `DELETE /:id`

- [ ] **Step 1: 写失败测试 test/jobs.test.ts**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import jobRoutes from "../src/server/routes/jobs";
import { encryptText } from "../src/server/crypto";
import { FakeD1 } from "./helpers/fake-d1";
import type { Env } from "../src/server/types";

let db: FakeD1;
let env: Env;
beforeEach(async () => {
  db = new FakeD1();
  env = { DB: db as unknown as D1Database, ASSETS: null as never, ADMIN_PASSWORD: "pw", TOKEN_ENC_KEY: "enckey" };
  db.accounts.push({
    id: 1, name: "acc1", github_login: "alice",
    token_encrypted: await encryptText("ghp_existing_token_xxxx", "enckey"),
    token_fingerprint: "****xxxx", status: "ok", last_verified_at: 1, created_at: 1, updated_at: 1,
  });
});

function req(path: string, init?: RequestInit) {
  return jobRoutes.request(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
  }, env);
}

const validBody = {
  name: "每日签到", account_id: 1, repo: "alice/repo1",
  trigger_type: "workflow_dispatch", workflow_id: "run.yml", ref: "main",
  inputs_json: null,
  schedule: { type: "interval", mode: "fixed", value: 45, unit: "m" },
};

describe("任务路由", () => {
  it("创建任务成功并算出 next_run_at", async () => {
    const res = await req("/", { method: "POST", body: JSON.stringify(validBody) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.next_run_at).toBeGreaterThan(Date.now());
    expect(json.data.next_run_at).toBeLessThanOrEqual(Date.now() + 46 * 60_000);
    expect(db.jobs).toHaveLength(1);
  });

  it("repository_dispatch 任务创建成功", async () => {
    const res = await req("/", {
      method: "POST",
      body: JSON.stringify({ ...validBody, trigger_type: "repository_dispatch", workflow_id: null, event_type: "cron" }),
    });
    expect(res.status).toBe(201);
  });

  it("非法参数被拒绝", async () => {
    const cases = [
      { ...validBody, name: "" },
      { ...validBody, repo: "不合法" },
      { ...validBody, trigger_type: "workflow_dispatch", workflow_id: "" },
      { ...validBody, schedule: { type: "cron", expr: "bad" } },
      { ...validBody, inputs_json: "not-json" },
      { ...validBody, account_id: 999 },
    ];
    for (const body of cases) {
      const res = await req("/", { method: "POST", body: JSON.stringify(body) });
      expect(res.status).toBe(400);
    }
    expect(db.jobs).toHaveLength(0);
  });

  it("列表带 account_name", async () => {
    await req("/", { method: "POST", body: JSON.stringify(validBody) });
    const res = await req("/");
    const json = await res.json();
    expect(json.data[0].account_name).toBe("acc1");
  });

  it("toggle 停用再启用，启用时重算 next_run_at", async () => {
    await req("/", { method: "POST", body: JSON.stringify(validBody) });
    await req("/1/toggle", { method: "POST" });
    expect(db.jobs[0].enabled).toBe(0);
    await req("/1/toggle", { method: "POST" });
    expect(db.jobs[0].enabled).toBe(1);
    expect(db.jobs[0].next_run_at as number).toBeGreaterThan(Date.now());
  });

  it("手动触发调用 GitHub 并记录 manual", async () => {
    const fn = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fn);
    await req("/", { method: "POST", body: JSON.stringify(validBody) });
    const res = await req("/1/trigger", { method: "POST" });
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(db.runs[0].source).toBe("manual");
    vi.unstubAllGlobals();
  });

  it("删除任务同时删除其运行记录", async () => {
    await req("/", { method: "POST", body: JSON.stringify(validBody) });
    db.runs.push({ id: 1, job_id: 1, triggered_at: 1, source: "manual", status: "success", http_status: 204, error_message: null });
    await req("/1", { method: "DELETE" });
    expect(db.jobs).toHaveLength(0);
    expect(db.runs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 src/server/routes/jobs.ts**

```ts
import { Hono } from "hono";
import { computeNextRun, validateSchedule, type ScheduleRule } from "../schedule";
import { triggerJobOnce } from "../scheduler";
import type { Env, JobRow } from "../types";

const jobRoutes = new Hono<{ Bindings: Env }>();

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const WORKFLOW_RE = /^[\w.-]+$/;

type JobInput = {
  name: string;
  account_id: number;
  repo: string;
  trigger_type: "workflow_dispatch" | "repository_dispatch";
  workflow_id: string | null;
  event_type: string | null;
  ref: string | null;
  inputs_json: string | null;
};

function validateJobBody(body: Record<string, unknown>): { ok: true; data: JobInput; schedule: ScheduleRule; enabled: number } | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return { ok: false, error: "任务名必填（≤100 字）" };
  const account_id = Number(body.account_id);
  if (!Number.isInteger(account_id) || account_id < 1) return { ok: false, error: "请选择账号" };
  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  if (!REPO_RE.test(repo)) return { ok: false, error: "仓库格式应为 owner/repo" };
  const trigger_type = body.trigger_type;
  if (trigger_type !== "workflow_dispatch" && trigger_type !== "repository_dispatch")
    return { ok: false, error: "触发类型必须是 workflow_dispatch / repository_dispatch" };

  let workflow_id: string | null = null;
  let event_type: string | null = null;
  let ref: string | null = null;
  if (trigger_type === "workflow_dispatch") {
    workflow_id = typeof body.workflow_id === "string" ? body.workflow_id.trim() : "";
    if (!WORKFLOW_RE.test(workflow_id)) return { ok: false, error: "请填写 workflow 文件名（如 run.yml）或 workflow ID" };
    ref = typeof body.ref === "string" && body.ref.trim() ? body.ref.trim() : "main";
    if (!WORKFLOW_RE.test(ref)) return { ok: false, error: "分支名非法" };
  } else {
    event_type = typeof body.event_type === "string" ? body.event_type.trim() : "";
    if (!event_type || event_type.length > 100) return { ok: false, error: "请填写 repository_dispatch 事件类型" };
  }

  let inputs_json: string | null = null;
  if (typeof body.inputs_json === "string" && body.inputs_json.trim()) {
    try {
      const v = JSON.parse(body.inputs_json);
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
    } catch {
      return { ok: false, error: "inputs / payload 必须是 JSON 对象" };
    }
    inputs_json = body.inputs_json.trim();
  }

  const sv = validateSchedule(body.schedule);
  if (!sv.ok) return { ok: false, error: sv.error };

  const enabled = body.enabled === 0 || body.enabled === false ? 0 : 1;
  return { ok: true, data: { name, account_id, repo, trigger_type, workflow_id, event_type, ref, inputs_json }, schedule: sv.rule, enabled };
}

jobRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT j.*, a.name AS account_name FROM jobs j LEFT JOIN accounts a ON j.account_id=a.id ORDER BY j.id DESC",
  ).all();
  return c.json({ ok: true, data: rows.results ?? [] });
});

jobRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as never);
  const v = validateJobBody(body);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  const acc = await c.env.DB.prepare("SELECT id FROM accounts WHERE id=?").bind(v.data.account_id).first();
  if (!acc) return c.json({ ok: false, error: "所选账号不存在" }, 400);

  const now = Date.now();
  const next_run_at = computeNextRun(v.schedule, now);
  const r = await c.env.DB.prepare(
    "INSERT INTO jobs (name, account_id, repo, trigger_type, workflow_id, event_type, ref, inputs_json, schedule_json, enabled, next_run_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(v.data.name, v.data.account_id, v.data.repo, v.data.trigger_type, v.data.workflow_id, v.data.event_type,
      v.data.ref, v.data.inputs_json, JSON.stringify(v.schedule), v.enabled, next_run_at, now, now)
    .run();
  const job = await c.env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(r.meta.last_row_id).first<JobRow>();
  return c.json({ ok: true, data: job }, 201);
});

jobRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const job = await c.env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<JobRow>();
  if (!job) return c.json({ ok: false, error: "任务不存在" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as never);
  const v = validateJobBody(body);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  const acc = await c.env.DB.prepare("SELECT id FROM accounts WHERE id=?").bind(v.data.account_id).first();
  if (!acc) return c.json({ ok: false, error: "所选账号不存在" }, 400);

  const now = Date.now();
  const next_run_at = computeNextRun(v.schedule, now);
  await c.env.DB.prepare(
    "UPDATE jobs SET name=?, account_id=?, repo=?, trigger_type=?, workflow_id=?, event_type=?, ref=?, inputs_json=?, schedule_json=?, enabled=?, next_run_at=?, updated_at=? WHERE id=?",
  )
    .bind(v.data.name, v.data.account_id, v.data.repo, v.data.trigger_type, v.data.workflow_id, v.data.event_type,
      v.data.ref, v.data.inputs_json, JSON.stringify(v.schedule), v.enabled, next_run_at, now, id)
    .run();
  const updated = await c.env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<JobRow>();
  return c.json({ ok: true, data: updated });
});

jobRoutes.post("/:id/toggle", async (c) => {
  const id = Number(c.req.param("id"));
  const job = await c.env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<JobRow>();
  if (!job) return c.json({ ok: false, error: "任务不存在" }, 404);
  const newEnabled = job.enabled === 1 ? 0 : 1;
  let nextRun = job.next_run_at;
  if (newEnabled === 1) {
    const sv = validateSchedule(JSON.parse(job.schedule_json));
    if (sv.ok) nextRun = computeNextRun(sv.rule, Date.now());
  }
  await c.env.DB.prepare("UPDATE jobs SET enabled=?, next_run_at=?, updated_at=? WHERE id=?")
    .bind(newEnabled, nextRun, Date.now(), id).run();
  return c.json({ ok: true, data: { enabled: newEnabled, next_run_at: nextRun } });
});

jobRoutes.post("/:id/trigger", async (c) => {
  const result = await triggerJobOnce(c.env, Number(c.req.param("id")), "manual");
  if ("notFound" in result) return c.json({ ok: false, error: "任务不存在" }, 404);
  if (!result.ok) return c.json({ ok: false, error: result.error ?? "触发失败" }, 502);
  return c.json({ ok: true, data: null });
});

jobRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM runs WHERE job_id=?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM jobs WHERE id=?").bind(id).run();
  return c.json({ ok: true, data: null });
});

export default jobRoutes;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/jobs.ts test/jobs.test.ts
git commit -m "feat: 任务管理路由(校验/调度计算/toggle/手动触发)"
```

---

### Task 10: 运行记录、统计与预览路由（src/server/routes/runs.ts、misc.ts）

**Files:**
- Create: `src/server/routes/runs.ts`, `src/server/routes/misc.ts`
- Test: `test/runs-misc.test.ts`

**Interfaces:**
- Consumes: `validateSchedule`、`previewRuns`、`describeSchedule`（Task 3）、FakeD1
- Produces:
  - `runRoutes`（挂载于 `/api/runs`）：`GET /?job_id=&page=`（每页 50，返回 `{total, page, rows}`，行含 `job_name`）、`POST /cleanup` body `{days?}`
  - `miscRoutes`（挂载于 `/api`）：`GET /stats`（返回 `{accounts, total_jobs, enabled_jobs, today_runs, failed_24h}`）、`GET /cron/preview?rule=<urlencoded JSON>`（返回 `{times: number[5], describe: string}`）

- [ ] **Step 1: 写失败测试 test/runs-misc.test.ts**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import runRoutes from "../src/server/routes/runs";
import miscRoutes from "../src/server/routes/misc";
import { FakeD1 } from "./helpers/fake-d1";
import type { Env } from "../src/server/types";

let db: FakeD1;
let env: Env;
beforeEach(() => {
  db = new FakeD1();
  env = { DB: db as unknown as D1Database, ASSETS: null as never, ADMIN_PASSWORD: "pw", TOKEN_ENC_KEY: "k" };
  db.jobs.push({ id: 1, name: "job1", account_id: 1, repo: "a/b", trigger_type: "workflow_dispatch", workflow_id: "x.yml", event_type: null, ref: "main", inputs_json: null, schedule_json: "{}", enabled: 1, next_run_at: 0, last_run_at: null, created_at: 0, updated_at: 0 });
  db.runs.push(
    { id: 1, job_id: 1, triggered_at: 100, source: "schedule", status: "success", http_status: 204, error_message: null },
    { id: 2, job_id: 1, triggered_at: 200, source: "manual", status: "failed", http_status: 401, error_message: "GitHub API 401" },
    { id: 3, job_id: 9, triggered_at: 300, source: "schedule", status: "success", http_status: 204, error_message: null },
  );
});

describe("runs 路由", () => {
  it("列表按时间倒序并带 job_name", async () => {
    const res = await runRoutes.request("/", {}, env);
    const json = await res.json();
    expect(json.data.total).toBe(3);
    expect(json.data.rows).toHaveLength(3);
    expect(json.data.rows[0].id).toBe(3);
    expect(json.data.rows[0].job_name).toBeNull();
    expect(json.data.rows[2].job_name).toBe("job1");
  });
  it("按 job_id 筛选", async () => {
    const res = await runRoutes.request("/?job_id=1", {}, env);
    const json = await res.json();
    expect(json.data.total).toBe(2);
  });
  it("cleanup 删除过期记录", async () => {
    db.runs.push({ id: 4, job_id: 1, triggered_at: Date.now() - 91 * 24 * 3600 * 1000, source: "schedule", status: "success", http_status: 204, error_message: null });
    const res = await runRoutes.request("/cleanup", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }, env);
    const json = await res.json();
    expect(json.data.deleted).toBe(1);
    expect(db.runs).toHaveLength(3);
  });
});

describe("misc 路由", () => {
  it("stats 返回计数", async () => {
    const res = await miscRoutes.request("/stats", {}, env);
    const json = await res.json();
    expect(json.data).toMatchObject({ total_jobs: 1, enabled_jobs: 1 });
  });
  it("cron/preview 返回 5 个时间与描述", async () => {
    const rule = encodeURIComponent(JSON.stringify({ type: "interval", mode: "fixed", value: 30, unit: "m" }));
    const res = await miscRoutes.request(`/cron/preview?rule=${rule}`, {}, env);
    const json = await res.json();
    expect(json.data.times).toHaveLength(5);
    expect(json.data.describe).toContain("30");
  });
  it("非法规则返回 400", async () => {
    const rule = encodeURIComponent(JSON.stringify({ type: "cron", expr: "bad" }));
    const res = await miscRoutes.request(`/cron/preview?rule=${rule}`, {}, env);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 src/server/routes/runs.ts**

```ts
import { Hono } from "hono";
import type { Env } from "../types";

const runRoutes = new Hono<{ Bindings: Env }>();
const PAGE_SIZE = 50;

runRoutes.get("/", async (c) => {
  const jobId = Number(c.req.query("job_id") ?? 0);
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const where = jobId > 0 ? "WHERE r.job_id=?" : "";
  const binds = jobId > 0 ? [jobId] : [];

  const cnt = await c.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM runs r ${where}`)
    .bind(...binds)
    .first<{ cnt: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT r.*, j.name AS job_name FROM runs r LEFT JOIN jobs j ON r.job_id=j.id ${where} ORDER BY r.triggered_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, PAGE_SIZE, offset)
    .all();
  return c.json({ ok: true, data: { total: cnt?.cnt ?? 0, page, rows: rows.results ?? [] } });
});

runRoutes.post("/cleanup", async (c) => {
  const body = await c.req.json<{ days?: unknown }>().catch(() => ({}) as never);
  const days = Number.isInteger(body.days) && (body.days as number) > 0 ? body.days as number : 90;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const r = await c.env.DB.prepare("DELETE FROM runs WHERE triggered_at < ?").bind(cutoff).run();
  return c.json({ ok: true, data: { deleted: r.meta.changes ?? 0 } });
});

export default runRoutes;
```

- [ ] **Step 4: 实现 src/server/routes/misc.ts**

```ts
import { Hono } from "hono";
import { describeSchedule, previewRuns, validateSchedule } from "../schedule";
import type { Env } from "../types";

const miscRoutes = new Hono<{ Bindings: Env }>();

miscRoutes.get("/stats", async (c) => {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM accounts) AS accounts,
       (SELECT COUNT(*) FROM jobs) AS total_jobs,
       (SELECT COUNT(*) FROM jobs WHERE enabled=1) AS enabled_jobs,
       (SELECT COUNT(*) FROM runs WHERE triggered_at>=?) AS today_runs,
       (SELECT COUNT(*) FROM runs WHERE triggered_at>=? AND status='failed') AS failed_24h`,
  )
    .bind(dayStart.getTime(), Date.now() - 24 * 3600 * 1000)
    .first();
  return c.json({ ok: true, data: row ?? {} });
});

miscRoutes.get("/cron/preview", async (c) => {
  const raw = c.req.query("rule");
  if (!raw) return c.json({ ok: false, error: "缺少 rule 参数" }, 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ ok: false, error: "rule 不是合法 JSON" }, 400);
  }
  const v = validateSchedule(parsed);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  return c.json({ ok: true, data: { times: previewRuns(v.rule, 5), describe: describeSchedule(v.rule) } });
});

export default miscRoutes;
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS；随后 `npm run typecheck` 无错误

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/runs.ts src/server/routes/misc.ts test/runs-misc.test.ts
git commit -m "feat: 运行记录分页/清理、统计与调度预览接口"
```

---

### Task 11: Worker 组装（路由挂载 + scheduled + 静态资源兜底）

**Files:**
- Modify: `src/worker.ts`（整体替换 Task 1 的骨架）

**Interfaces:**
- Consumes: 全部路由（Task 7-10）、`runDueJobs`（Task 6）、`requireAuth`（Task 7）
- Produces: 最终 Worker 入口。`/api/auth/*` 公开；其余 `/api/*` 走 `requireAuth`；非 API 路径交给 `ASSETS`（SPA fallback 由 wrangler 配置处理）

- [ ] **Step 1: 替换 src/worker.ts**

```ts
import { Hono } from "hono";
import authRoutes from "./server/routes/auth";
import accountRoutes from "./server/routes/accounts";
import jobRoutes from "./server/routes/jobs";
import runRoutes from "./server/routes/runs";
import miscRoutes from "./server/routes/misc";
import { requireAuth } from "./server/middleware";
import { runDueJobs } from "./server/scheduler";
import type { Env } from "./server/types";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/auth", authRoutes);

const protectedApi = new Hono<{ Bindings: Env }>();
protectedApi.use("*", requireAuth);
protectedApi.route("/accounts", accountRoutes);
protectedApi.route("/jobs", jobRoutes);
protectedApi.route("/runs", runRoutes);
protectedApi.route("/", miscRoutes); // /stats 与 /cron/preview
app.route("/api", protectedApi);

app.all("/api/*", (c) => c.json({ ok: false, error: "Not Found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Env, _ctx: ExecutionContext) => {
    await runDueJobs(env);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 2: 类型检查与全部测试**

Run: `npm run typecheck`
Expected: 无错误

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 3: 本地冒烟（手动）**

```bash
cp .dev.vars.example .dev.vars   # 编辑为真实随机值：ADMIN_PASSWORD=测试密码, TOKEN_ENC_KEY=任意64位hex
npm run db:local                 # 初始化本地 D1
npm run dev                      # vite dev（API 由 cloudflare 插件同源代理）
```

在另一个终端验证：

```bash
# 未登录访问受保护接口 → 401
curl -s http://localhost:5173/api/accounts
# 期望: {"ok":false,"error":"未登录"}

# 登录 → 拿到 Cookie
curl -si -X POST http://localhost:5173/api/auth/login -H "Content-Type: application/json" -d '{"password":"测试密码"}'
# 期望: 200 + set-cookie: session=...

# 带 Cookie 创建账号（verify:false 避免真实调 GitHub）
curl -s -X POST http://localhost:5173/api/accounts -H "Content-Type: application/json" \
  -b "session=<上一步的令牌>" \
  -d '{"name":"测试","token":"ghp_smoke_test_0123456789abcdef"}'
# 期望: 201 + data（不含 token 明文）
```

浏览器打开 `http://localhost:5173` 应看到"脚手架就绪"（Task 12 起替换为真实前端）。

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "feat: Worker组装(路由挂载/scheduled调度/静态资源兜底)"
```

---

### Task 12: 前端骨架（api 封装、路由、布局、登录页、Toast）

**Files:**
- Create: `src/client/api.ts`, `src/client/types.ts`, `src/client/App.tsx`, `src/client/components/Toast.tsx`, `src/client/components/Layout.tsx`, `src/client/pages/Login.tsx`
- Modify: `src/client/main.tsx`

**Interfaces:**
- Consumes: 后端全部 API（Task 7-11）
- Produces:
  - `get/post/put/del`（`src/client/api.ts`，401 自动跳 /login，非 `ok` 响应 throw Error(中文错误)）与 `fmtTime(ms)` 辅助
  - `type Account / Job / Run / Stats / Schedule`（`src/client/types.ts`，字段与后端 JSON 一致）
  - `useToast()`（Toast 上下文，`push(message, kind?)`）
  - 布局组件 `Layout`（左侧导航 + Outlet）与登录页；`/jobs /accounts /runs` 页面本任务先占位

- [ ] **Step 1: 创建 src/client/api.ts**

```ts
type ApiResp<T> = { ok: true; data: T } | { ok: false; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    location.href = "/login";
    throw new Error("未登录");
  }
  const json = (await res.json().catch(() => ({ ok: false, error: "响应解析失败" }))) as ApiResp<T>;
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

export const get = <T,>(path: string) => request<T>(path);
export const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });

export const fmtTime = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "-";
```

- [ ] **Step 2: 创建 src/client/types.ts**

```ts
export type Account = {
  id: number;
  name: string;
  github_login: string | null;
  token_fingerprint: string;
  status: string;
  last_verified_at: number | null;
};

export type Schedule = {
  type: "cron" | "interval";
  expr?: string;
  mode?: "fixed" | "random";
  value?: number;
  min?: number;
  max?: number;
  unit?: "m" | "h" | "d";
};

export type Job = {
  id: number;
  name: string;
  account_id: number;
  account_name: string | null;
  repo: string;
  trigger_type: "workflow_dispatch" | "repository_dispatch";
  workflow_id: string | null;
  event_type: string | null;
  ref: string | null;
  inputs_json: string | null;
  schedule_json: string;
  enabled: number;
  next_run_at: number;
  last_run_at: number | null;
};

export type Run = {
  id: number;
  job_id: number;
  job_name?: string | null;
  triggered_at: number;
  source: "schedule" | "manual";
  status: "success" | "failed";
  http_status: number | null;
  error_message: string | null;
};

export type Stats = {
  accounts: number;
  total_jobs: number;
  enabled_jobs: number;
  today_runs: number;
  failed_24h: number;
};
```

- [ ] **Step 3: 创建 src/client/components/Toast.tsx**

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "ok" | "err";
type ToastItem = { id: number; message: string; kind: Kind };

const Ctx = createContext<(message: string, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, kind: Kind = "ok") => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev, { id, message, kind }]);
    setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {items.map(t => (
          <div key={t.id} className={`rounded-lg px-4 py-2 text-sm text-white shadow-lg ${t.kind === "ok" ? "bg-emerald-600" : "bg-red-600"}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
```

- [ ] **Step 4: 创建 src/client/components/Layout.tsx**

```tsx
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { post } from "../api";

const links = [
  { to: "/", label: "仪表盘", end: true },
  { to: "/jobs", label: "任务", end: false },
  { to: "/accounts", label: "账号", end: false },
  { to: "/runs", label: "运行记录", end: false },
];

export default function Layout() {
  const nav = useNavigate();
  async function logout() {
    await post("/api/auth/logout");
    nav("/login");
  }
  return (
    <div className="flex min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <aside className="flex w-52 shrink-0 flex-col border-r border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-6 px-2 text-lg font-bold">Actions 定时中心</div>
        <nav className="flex flex-col gap-1">
          {links.map(l => (
            <NavLink key={l.to} to={l.to} end={l.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-indigo-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={logout} className="mt-auto rounded-lg px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
          退出登录
        </button>
      </aside>
      <main className="flex-1 overflow-x-auto p-6"><Outlet /></main>
    </div>
  );
}
```

- [ ] **Step 5: 创建 src/client/pages/Login.tsx**

```tsx
import { useState } from "react";
import { post } from "../api";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/login", { password });
      location.href = "/";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <form onSubmit={submit} className="w-80 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="mb-6 text-center text-xl font-bold">Actions 定时中心</h1>
        <input type="password" placeholder="管理密码" value={password} autoFocus
          onChange={e => setPassword(e.target.value)}
          className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
        {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950">{error}</div>}
        <button disabled={busy} className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: 创建 App.tsx 与占位页，更新 main.tsx**

`src/client/App.tsx`：

```tsx
import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Jobs from "./pages/Jobs";
import Accounts from "./pages/Accounts";
import Runs from "./pages/Runs";

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/runs" element={<Runs />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
```

四个占位页（本步先建空壳，Task 13-15 替换）。`src/client/pages/Dashboard.tsx`（Jobs/Accounts/Runs 同样写法，改组件名与文案）：

```tsx
export default function Dashboard() {
  return <div className="text-neutral-500">仪表盘（待实现）</div>;
}
```

`src/client/main.tsx` 替换为：

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

- [ ] **Step 7: 验证**

Run: `npm run typecheck` → 无错误
Run: `npm run build` → 构建成功
Run: `npm run dev`，浏览器 `http://localhost:5173`：未登录访问 `/` 也会渲染（SPA 不做路由守卫，由 API 401 兜底跳转）；直接访问 `/login` 可输密码登录，成功后进入带侧边栏的布局，四个页面显示占位文案。

- [ ] **Step 8: Commit**

```bash
git add src/client
git commit -m "feat: 前端骨架(路由/布局/登录/Toast/api封装)"
```

---

### Task 13: 账号管理页

**Files:**
- Modify: `src/client/pages/Accounts.tsx`（替换占位）

**Interfaces:**
- Consumes: `GET/POST /api/accounts`、`POST /api/accounts/:id/verify`、`PUT/DELETE /api/accounts/:id`、`type Account`、`useToast`、api 封装
- Produces: 完整账号管理页（卡片列表 + 新增表单 + 验证/删除）

- [ ] **Step 1: 实现 src/client/pages/Accounts.tsx**

```tsx
import { useEffect, useState } from "react";
import { del, fmtTime, get, post } from "../api";
import { useToast } from "../components/Toast";
import type { Account } from "../types";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    ok: ["bg-emerald-100 text-emerald-700", "有效"],
    invalid: ["bg-red-100 text-red-700", "失效"],
    unknown: ["bg-neutral-100 text-neutral-500", "未验证"],
  };
  const [cls, label] = map[status] ?? map.unknown;
  return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>;
}

export default function Accounts() {
  const toast = useToast();
  const [list, setList] = useState<Account[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setList(await get<Account[]>("/api/accounts"));
  }
  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/api/accounts", { name, token, verify });
      toast("账号已添加");
      setShowForm(false); setName(""); setToken("");
      await load();
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function reVerify(a: Account) {
    try {
      await post(`/api/accounts/${a.id}/verify`);
      toast(`验证通过：${a.name}`);
      await load();
    } catch (err) {
      toast((err as Error).message, "err");
      await load();
    }
  }

  async function remove(a: Account) {
    if (!confirm(`删除账号「${a.name}」？其下所有任务与运行记录会一并删除。`)) return;
    await del(`/api/accounts/${a.id}`);
    toast("已删除");
    await load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">GitHub 账号</h1>
        <button onClick={() => setShowForm(v => !v)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500">
          {showForm ? "取消" : "+ 添加账号"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="mb-6 max-w-xl rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <label className="mb-1 block text-sm">备注名</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="如：主账号"
            className="mb-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
          <label className="mb-1 block text-sm">Personal Access Token</label>
          <input value={token} onChange={e => setToken(e.target.value)} placeholder="ghp_… / github_pat_…" type="password"
            className="mb-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={verify} onChange={e => setVerify(e.target.checked)} />
            保存时在线验证 Token（推荐）
          </label>
          <button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? "保存中…" : "保存"}
          </button>
          <p className="mt-3 text-xs text-neutral-500">Token 加密存储，保存后不再显示明文。建议使用最小权限的 Fine-grained PAT。</p>
        </form>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map(a => (
          <div key={a.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <div className="font-medium">{a.name}</div>
                <div className="text-sm text-neutral-500">{a.github_login ? `@${a.github_login}` : "未验证登录名"}</div>
              </div>
              <StatusBadge status={a.status} />
            </div>
            <div className="mb-1 font-mono text-sm text-neutral-500">{a.token_fingerprint}</div>
            <div className="mb-3 text-xs text-neutral-400">上次验证：{fmtTime(a.last_verified_at)}</div>
            <div className="flex gap-2">
              <button onClick={() => reVerify(a)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">重新验证</button>
              <button onClick={() => remove(a)} className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950">删除</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="text-sm text-neutral-500">还没有账号，点击右上角添加。</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证**

Run: `npm run typecheck` → 无错误
Run: `npm run dev` → 登录后进入"账号"页：添加假 token（`ghp_smoke_test_0123456789abcdef`，不勾验证）出现卡片；勾选验证+假 token 保存会报中文错误并保留在表单；删除有确认框。

- [ ] **Step 3: Commit**

```bash
git add src/client/pages/Accounts.tsx
git commit -m "feat: 账号管理页(卡片/添加验证/删除)"
```

---

### Task 14: 任务管理页（表单抽屉 + 调度编辑器 + 预览）

**Files:**
- Modify: `src/client/pages/Jobs.tsx`（替换占位）

**Interfaces:**
- Consumes: `GET/POST /api/jobs`、`PUT/DELETE /api/jobs/:id`、`POST /api/jobs/:id/toggle|trigger`、`GET /api/accounts`、`GET /api/cron/preview?rule=`、`type Job/Account/Schedule`
- Produces: 任务列表（表格 + 开关 + 立即触发）与新建/编辑抽屉（含 `ScheduleEditor` 子组件，防抖调用预览接口）

- [ ] **Step 1: 实现 src/client/pages/Jobs.tsx**

```tsx
import { useEffect, useState } from "react";
import { del, fmtTime, get, post, put } from "../api";
import { useToast } from "../components/Toast";
import type { Account, Job, Schedule } from "../types";

type FormData = {
  id?: number;
  name: string;
  account_id: number;
  repo: string;
  trigger_type: "workflow_dispatch" | "repository_dispatch";
  workflow_id: string;
  event_type: string;
  ref: string;
  inputs_json: string;
  schedule: Schedule;
};

const EMPTY: FormData = {
  name: "", account_id: 0, repo: "", trigger_type: "workflow_dispatch",
  workflow_id: "", event_type: "", ref: "main", inputs_json: "",
  schedule: { type: "interval", mode: "fixed", value: 45, unit: "m" },
};

function parseSchedule(json: string): Schedule {
  try { return JSON.parse(json) as Schedule; } catch { return EMPTY.schedule; }
}

function describeLocal(s: Schedule): string {
  if (s.type === "cron") return `cron ${s.expr ?? ""}（UTC）`;
  const u = { m: "分钟", h: "小时", d: "天" }[s.unit ?? "m"];
  if (s.mode === "random") return `每 ${s.min}~${s.max} ${u}（随机）`;
  return `每 ${s.value} ${u}`;
}

function ScheduleEditor({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const [preview, setPreview] = useState<string[]>([]);
  const [previewErr, setPreviewErr] = useState("");
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const data = await get<{ times: number[] }>(`/api/cron/preview?rule=${encodeURIComponent(JSON.stringify(value))}`);
        setPreview(data.times.map(fmtTime));
        setPreviewErr("");
      } catch (err) {
        setPreview([]);
        setPreviewErr((err as Error).message);
      }
    }, 400); // 防抖
    return () => clearTimeout(t);
  }, [JSON.stringify(value)]);

  const inputCls = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800";
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-3 flex gap-2 text-sm">
        {[
          ["interval", "间隔"], ["cron", "cron 表达式"],
        ].map(([t, label]) => (
          <button key={t} type="button" onClick={() =>
            onChange(t === "cron"
              ? { type: "cron", expr: "30 3 * * *" }
              : { type: "interval", mode: "fixed", value: 45, unit: "m" })
          } className={`rounded-lg px-3 py-1.5 ${value.type === t ? "bg-indigo-600 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {value.type === "cron" ? (
        <div>
          <input className={inputCls} value={value.expr ?? ""} placeholder="分 时 日 月 周（UTC），如 30 3 * * *"
            onChange={e => onChange({ ...value, expr: e.target.value })} />
          <p className="mt-1 text-xs text-neutral-500">支持 *、*/n、a-b、逗号列表。按 UTC 时区计算。</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select className={inputCls + " w-28"} value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as "fixed" | "random", ...(e.target.value === "random" ? { min: 30, max: 90 } : { value: 45 }) })}>
            <option value="fixed">固定间隔</option>
            <option value="random">随机间隔</option>
          </select>
          {value.mode === "random" ? (
            <>
              <input type="number" min={1} className={inputCls + " w-24"} value={value.min ?? 30} onChange={e => onChange({ ...value, min: Number(e.target.value) })} />
              <span>~</span>
              <input type="number" min={1} className={inputCls + " w-24"} value={value.max ?? 90} onChange={e => onChange({ ...value, max: Number(e.target.value) })} />
            </>
          ) : (
            <input type="number" min={1} className={inputCls + " w-24"} value={value.value ?? 45} onChange={e => onChange({ ...value, value: Number(e.target.value) })} />
          )}
          <select className={inputCls + " w-20"} value={value.unit ?? "m"} onChange={e => onChange({ ...value, unit: e.target.value as "m" | "h" | "d" })}>
            <option value="m">分钟</option>
            <option value="h">小时</option>
            <option value="d">天</option>
          </select>
        </div>
      )}

      <div className="mt-3 text-xs">
        {previewErr
          ? <span className="text-red-500">{previewErr}</span>
          : <div className="text-neutral-500">
              未来触发时间：
              <ul className="mt-1 list-inside list-disc font-mono">{preview.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>}
      </div>
    </div>
  );
}

export default function Jobs() {
  const toast = useToast();
  const [list, setList] = useState<Job[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState<FormData | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setList(await get<Job[]>("/api/jobs"));
  }
  useEffect(() => {
    load();
    get<Account[]>("/api/accounts").then(setAccounts);
  }, []);

  function edit(j: Job) {
    setForm({
      id: j.id, name: j.name, account_id: j.account_id, repo: j.repo,
      trigger_type: j.trigger_type, workflow_id: j.workflow_id ?? "",
      event_type: j.event_type ?? "", ref: j.ref ?? "main",
      inputs_json: j.inputs_json ?? "", schedule: parseSchedule(j.schedule_json),
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    const body = { ...form };
    try {
      if (form.id) await put(`/api/jobs/${form.id}`, body);
      else await post("/api/jobs", body);
      toast(form.id ? "任务已更新" : "任务已创建");
      setForm(null);
      await load();
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(j: Job) {
    await post(`/api/jobs/${j.id}/toggle`);
    await load();
  }
  async function triggerNow(j: Job) {
    try {
      await post(`/api/jobs/${j.id}/trigger`);
      toast(`已触发：${j.name}`);
    } catch (err) {
      toast((err as Error).message, "err");
    }
  }
  async function remove(j: Job) {
    if (!confirm(`删除任务「${j.name}」？其运行记录会一并删除。`)) return;
    await del(`/api/jobs/${j.id}`);
    toast("已删除");
    await load();
  }

  const inputCls = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800";
  const labelCls = "mb-1 block text-sm";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">定时任务</h1>
        <button onClick={() => setForm({ ...EMPTY })} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500">+ 新建任务</button>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
            <tr>
              <th className="p-3">任务</th><th className="p-3">账号</th><th className="p-3">仓库</th>
              <th className="p-3">触发</th><th className="p-3">调度</th><th className="p-3">下次运行</th>
              <th className="p-3">上次运行</th><th className="p-3">状态</th><th className="p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map(j => (
              <tr key={j.id} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/50">
                <td className="p-3 font-medium">{j.name}</td>
                <td className="p-3">{j.account_name ?? "-"}</td>
                <td className="p-3 font-mono text-xs">{j.repo}</td>
                <td className="p-3 text-xs">{j.trigger_type === "workflow_dispatch" ? `${j.workflow_id}@${j.ref}` : j.event_type}</td>
                <td className="p-3 text-xs">{describeLocal(parseSchedule(j.schedule_json))}</td>
                <td className="p-3 text-xs">{fmtTime(j.next_run_at)}</td>
                <td className="p-3 text-xs">{fmtTime(j.last_run_at)}</td>
                <td className="p-3">
                  <button onClick={() => toggle(j)}
                    className={`h-5 w-9 rounded-full transition-colors ${j.enabled ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"}`}>
                    <span className={`block h-4 w-4 translate-y-0.5 rounded-full bg-white transition-transform ${j.enabled ? "translate-x-4 ml-0.5" : "translate-x-0.5"}`} />
                  </button>
                </td>
                <td className="p-3">
                  <div className="flex gap-1 text-xs">
                    <button onClick={() => triggerNow(j)} className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">立即触发</button>
                    <button onClick={() => edit(j)} className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">编辑</button>
                    <button onClick={() => remove(j)} className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950">删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-neutral-500">还没有任务，点击右上角新建。</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={() => setForm(null)}>
          <form onSubmit={submit} onClick={e => e.stopPropagation()}
            className="h-full w-[480px] max-w-full overflow-y-auto bg-white p-6 dark:bg-neutral-900">
            <h2 className="mb-4 text-lg font-bold">{form.id ? "编辑任务" : "新建任务"}</h2>

            <label className={labelCls}>任务名</label>
            <input className={inputCls + " mb-3"} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />

            <label className={labelCls}>GitHub 账号</label>
            <select className={inputCls + " mb-3"} value={form.account_id} onChange={e => setForm({ ...form, account_id: Number(e.target.value) })}>
              <option value={0}>请选择…</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.github_login ? `（@${a.github_login}）` : ""}</option>)}
            </select>

            <label className={labelCls}>仓库（owner/repo）</label>
            <input className={inputCls + " mb-3"} value={form.repo} placeholder="alice/repo1" onChange={e => setForm({ ...form, repo: e.target.value })} />

            <label className={labelCls}>触发方式</label>
            <div className="mb-3 flex gap-2 text-sm">
              {(["workflow_dispatch", "repository_dispatch"] as const).map(t => (
                <button key={t} type="button" onClick={() => setForm({ ...form, trigger_type: t })}
                  className={`rounded-lg px-3 py-1.5 ${form.trigger_type === t ? "bg-indigo-600 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}>
                  {t}
                </button>
              ))}
            </div>

            {form.trigger_type === "workflow_dispatch" ? (
              <>
                <label className={labelCls}>Workflow 文件名 / ID</label>
                <input className={inputCls + " mb-3"} value={form.workflow_id} placeholder="如 run.yml" onChange={e => setForm({ ...form, workflow_id: e.target.value })} />
                <label className={labelCls}>分支 / Ref</label>
                <input className={inputCls + " mb-3"} value={form.ref} onChange={e => setForm({ ...form, ref: e.target.value })} />
              </>
            ) : (
              <>
                <label className={labelCls}>事件类型（event_type）</label>
                <input className={inputCls + " mb-3"} value={form.event_type} placeholder="如 cron" onChange={e => setForm({ ...form, event_type: e.target.value })} />
              </>
            )}

            <label className={labelCls}>inputs / payload（JSON 对象，可留空）</label>
            <textarea className={inputCls + " mb-3 font-mono text-xs"} rows={3} value={form.inputs_json}
              placeholder='{"key":"value"}' onChange={e => setForm({ ...form, inputs_json: e.target.value })} />

            <label className={labelCls}>调度规则</label>
            <div className="mb-4">
              <ScheduleEditor value={form.schedule} onChange={s => setForm({ ...form, schedule: s })} />
            </div>

            <div className="flex gap-2">
              <button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50">
                {busy ? "保存中…" : "保存"}
              </button>
              <button type="button" onClick={() => setForm(null)} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700">取消</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 验证**

Run: `npm run typecheck` → 无错误
Run: `npm run dev` → 新建任务：选账号、填仓库、切换调度类型时右侧出现"未来触发时间"预览；非法 cron 表达式预览区显示红字错误；保存后表格出现新行，开关/立即触发/编辑/删除均可用。

- [ ] **Step 3: Commit**

```bash
git add src/client/pages/Jobs.tsx
git commit -m "feat: 任务管理页(表格/开关/抽屉表单/调度预览)"
```

---

### Task 15: 运行记录页与仪表盘

**Files:**
- Modify: `src/client/pages/Runs.tsx`, `src/client/pages/Dashboard.tsx`（替换占位）

**Interfaces:**
- Consumes: `GET /api/runs?job_id=&page=`、`GET /api/jobs`、`GET /api/stats`、`type Run/Job/Stats`
- Produces: 运行记录页（筛选 + 分页 + 失败详情展开）与仪表盘（统计卡片 + 最近流水）

- [ ] **Step 1: 实现 src/client/pages/Runs.tsx**

```tsx
import { useEffect, useState } from "react";
import { fmtTime, get, post } from "../api";
import { useToast } from "../components/Toast";
import type { Job, Run } from "../types";

const PAGE_SIZE = 50;

export default function Runs() {
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Run[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => { get<Job[]>("/api/jobs").then(setJobs); }, []);

  useEffect(() => {
    const q = new URLSearchParams({ page: String(page), ...(jobId ? { job_id: String(jobId) } : {}) });
    get<{ total: number; rows: Run[] }>(`/api/runs?${q}`).then(d => {
      setTotal(d.total);
      setRows(d.rows);
    });
  }, [jobId, page]);

  async function cleanup() {
    if (!confirm("清理 90 天前的运行记录？")) return;
    const d = await post<{ deleted: number }>("/api/runs/cleanup", {});
    toast(`已清理 ${d.deleted} 条`);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">运行记录 <span className="text-sm font-normal text-neutral-500">（共 {total} 条）</span></h1>
        <button onClick={cleanup} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700">清理 90 天前记录</button>
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-neutral-500">按任务筛选：</span>
        <select value={jobId} onChange={e => { setJobId(Number(e.target.value)); setPage(1); }}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 dark:bg-neutral-800">
          <option value={0}>全部</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
            <tr><th className="p-3">时间</th><th className="p-3">任务</th><th className="p-3">来源</th><th className="p-3">状态</th><th className="p-3">HTTP</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <>
                <tr key={r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className={`cursor-pointer border-b border-neutral-100 last:border-0 dark:border-neutral-800/50 ${r.status === "failed" ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}>
                  <td className="p-3 text-xs">{fmtTime(r.triggered_at)}</td>
                  <td className="p-3">{r.job_name ?? `任务#${r.job_id}`}</td>
                  <td className="p-3 text-xs">{r.source === "manual" ? "手动" : "定时"}</td>
                  <td className={`p-3 text-xs ${r.status === "failed" ? "font-medium text-red-600" : "text-emerald-600"}`}>
                    {r.status === "failed" ? "失败" : "成功"}
                  </td>
                  <td className="p-3 font-mono text-xs">{r.http_status || "-"}</td>
                </tr>
                {expanded === r.id && r.error_message && (
                  <tr key={`${r.id}-detail`} className="border-b border-neutral-100 dark:border-neutral-800/50">
                    <td colSpan={5} className="p-3 font-mono text-xs text-red-600">{r.error_message}</td>
                  </tr>
                )}
              </>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-neutral-500">暂无记录</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-3 text-sm">
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border border-neutral-300 px-3 py-1.5 disabled:opacity-40 dark:border-neutral-700">上一页</button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-neutral-300 px-3 py-1.5 disabled:opacity-40 dark:border-neutral-700">下一页</button>
      </div>
    </div>
  );
}
```

注意：`rows.map` 里返回 fragment 包含两行时，React 要求 key 放在 fragment 上。实现时写成：

```tsx
{rows.map(r => (
  <Fragment key={r.id}>
    {/* 两个 <tr>，去掉各自 key */}
  </Fragment>
))}
```

并在文件顶部 `import { Fragment, useEffect, useState } from "react";`。

- [ ] **Step 2: 实现 src/client/pages/Dashboard.tsx**

```tsx
import { useEffect, useState } from "react";
import { fmtTime, get } from "../api";
import type { Run, Stats } from "../types";

function Card({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${danger && Number(value) > 0 ? "text-red-600" : ""}`}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Run[]>([]);

  useEffect(() => {
    get<Stats>("/api/stats").then(setStats);
    get<{ rows: Run[] }>("/api/runs?page=1").then(d => setRecent(d.rows.slice(0, 20)));
  }, []);

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">仪表盘</h1>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card label="账号数" value={stats?.accounts ?? "-"} />
        <Card label="任务数" value={stats?.total_jobs ?? "-"} />
        <Card label="启用中" value={stats?.enabled_jobs ?? "-"} />
        <Card label="今日触发" value={stats?.today_runs ?? "-"} />
        <Card label="近 24h 失败" value={stats?.failed_24h ?? "-"} danger />
      </div>

      <h2 className="mb-2 font-medium">最近运行</h2>
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
            <tr><th className="p-3">时间</th><th className="p-3">任务</th><th className="p-3">来源</th><th className="p-3">状态</th></tr>
          </thead>
          <tbody>
            {recent.map(r => (
              <tr key={r.id} className={`border-b border-neutral-100 last:border-0 dark:border-neutral-800/50 ${r.status === "failed" ? "text-red-600" : ""}`}>
                <td className="p-3 text-xs">{fmtTime(r.triggered_at)}</td>
                <td className="p-3">{r.job_name ?? `任务#${r.job_id}`}</td>
                <td className="p-3 text-xs">{r.source === "manual" ? "手动" : "定时"}</td>
                <td className="p-3 text-xs">{r.status === "failed" ? "失败" : "成功"}</td>
              </tr>
            ))}
            {recent.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-neutral-500">暂无记录</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck` → 无错误
Run: `npm run build` → 构建成功
Run: `npm run dev` → 手动触发一次任务后：仪表盘统计变化、最近流水出现条目；运行记录页可筛选/翻页（可临时在浏览器控制台循环调用触发接口造数据，或直接查表格）

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/Runs.tsx src/client/pages/Dashboard.tsx
git commit -m "feat: 运行记录页与仪表盘"
```

---

### Task 16: README、部署文档与全链路验证

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: 全部
- Produces: 部署文档与最终验证清单

- [ ] **Step 1: 创建 README.md**

````markdown
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
curl "http://localhost:8787/__scheduled?cron=*"
```

## 部署

1. 创建 D1 数据库，并把返回的 database_id 填入 `wrangler.jsonc`：

   ```bash
   npx wrangler d1 create cronjob
   ```

2. 初始化远程数据库表结构：

   ```bash
   npm run db:init
   ```

3. 设置两个 Secret（TOKEN_ENC_KEY 建议用 `openssl rand -hex 32` 生成；换钥匙会导致已存 token 无法解密）：

   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put TOKEN_ENC_KEY
   ```

4. 部署：

   ```bash
   npm run deploy
   ```

## 使用说明

- GitHub 仓库的 workflow 需声明对应触发器：
  - `workflow_dispatch`：workflow 文件里写 `on: workflow_dispatch`（可带 inputs）
  - `repository_dispatch`：workflow 文件里写 `on: repository_dispatch: [事件类型]`
- cron 表达式按 **UTC** 计算（北京时间减 8 小时）。
- 调度器每 5 分钟扫描一次到期任务；Cloudflare 免费计划可能有约 1 分钟的 cron 延迟。

## 技术栈

Hono · React 18 · Vite · Tailwind CSS v4 · Cloudflare Workers · D1 · Vitest
````

- [ ] **Step 2: 全链路验证（本地，手动）**

前置：`npm run build` 已执行。

1. `npx wrangler dev --test-scheduled` 启动（端口 8787）
2. 登录拿 Cookie：`curl -si -X POST http://localhost:8787/api/auth/login -H "Content-Type: application/json" -d '{"password":"<你的.dev.vars密码>"}'`
3. 用真实 GitHub PAT（对目标仓库有 actions 写权限）添加账号（勾验证）
4. 创建任务：目标仓库 + workflow（已声明 `on: workflow_dispatch`）+ 调度 `每 5 分钟`
5. 触发调度：`curl "http://localhost:8787/__scheduled?cron=*"` → 期望 `{"ok":...}`（200）
6. 检查：`GET /api/jobs` 的 `next_run_at` 已推进；`GET /api/runs` 出现 success 记录；GitHub 仓库 Actions 页出现新 run
7. 停用任务再触发 `__scheduled` → 无新记录
8. 换一个错误 token 的账号触发 → runs 出现 failed 记录、账号状态变 invalid

- [ ] **Step 3: 运行全部测试与类型检查**

Run: `npm test && npm run typecheck`
Expected: 全部 PASS、无类型错误

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README(本地开发/部署/使用说明)"
```

---

## 计划自审记录（写计划时已核对）

1. **规格覆盖**：规格第 3-8 节的架构、数据模型（schema.sql 与规格 SQL 一致，外键改在应用层显式级联删除）、API 表（含新增 `/api/stats`）、四个前端页面、错误处理（401 标记/乐观锁/漂移/清理/50 上限）、测试与部署均有对应 Task。
2. **占位符**：无 TBD/TODO；前端组件均给出完整代码。
3. **类型一致性**：`Env/JobRow/AccountRow`（Task 6）、`ScheduleRule`（Task 3）、`TriggerOutcome`（Task 6）与路由/调度器/前端 `types.ts` 字段名一致；FakeD1 支持所有路由与调度器发出的 SQL。





