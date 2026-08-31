# 前端视觉与交互重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有朴素的 Tailwind 后台改造成克制精致的现代管理界面，并补齐加载反馈、主题切换与响应式、表单与危险操作三块交互短板。

**Architecture:** 三层自下而上：`index.css` 的 CSS 变量令牌层（`@theme inline` 驱动，class 控制深浅色）→ `src/client/ui/` 无业务逻辑的原语组件层 → 页面层消费原语。服务端、API 契约、D1 schema 一行不动。

**Tech Stack:** React 18、React Router 6、Tailwind CSS v4（`@theme inline` + `@custom-variant`）、lucide-react、原生 `<dialog>`、Vitest（node 环境，仅测纯函数）。

**规格文档:** `docs/superpowers/specs/2026-08-31-frontend-redesign-design.md`

## Global Constraints

- 所有命令在项目根 `d:\Projects\Work\Cronjob` 执行；Node ≥ 20（当前 v24.11.1），npm 作为包管理器
- **唯一允许新增的依赖是 `lucide-react@1.37.0`**（精确版本，不用 `^`）。禁止引入 framer-motion、radix-ui、jsdom、@testing-library/*、clsx、tailwind-merge 等任何其他包
- 动效只能用 Tailwind 过渡类与手写 `@keyframes`；模态框只能用原生 `<dialog>`
- 不改 `src/server/**`、`src/worker.ts`、`src/schema.sql`、任何 API 的请求/响应形状
- 不改路由表：`/`、`/jobs`、`/accounts`、`/runs`、`/login`
- UI 文案全部中文
- 颜色一律走语义令牌类（`bg-panel`、`text-fg-muted`、`border-border`、`text-success`、`text-danger`）。**新代码中禁止出现 `dark:` 成对硬编码调色板类**，例如 `bg-white dark:bg-neutral-900`、`border-neutral-200 dark:border-neutral-800`
- `vitest.config.ts` 的 `include` 是 `test/**/*.test.ts`（只认 `.ts`）。前端测试文件必须是 `.ts`，且只能 import 纯 `.ts` 模块——不要在测试里 import `.tsx`，node 环境没有 DOM
- 测试命令 `npm test`；类型检查 `npm run typecheck`；构建 `npm run build`
- 每个 Task 结束必须 commit，commit message 用中文，遵循仓库现有的 `feat:` / `refactor:` / `style:` 前缀习惯

### 关于 TDD 的适用范围（重要）

本项目**没有**前端组件测试框架，且 Global Constraints 禁止引入（jsdom + testing-library 与「仅图标库」的依赖约束冲突，这是规格里的明确决策）。因此：

- **Task 1、Task 2 走完整 TDD**（红 → 绿 → 提交）：这两个任务的产出是纯函数，能在现有 node 环境的 vitest 里测。
- **Task 3 起的组件与页面任务无法写自动化测试**。它们的验证闸门是每个任务末尾明确列出的 `npm run typecheck` + `npm test`（确认没误伤服务端）+ `npm run build` + 一份具体的人工核验清单。清单里的每一条都是可判定的（看到 X / 没看到 Y），不是「看起来对不对」。
- 不要为了凑 TDD 去给组件加 `.tsx` 测试或偷偷装测试库。

---

## File Structure

| 路径 | 状态 | 职责 |
|---|---|---|
| `index.html` | 改 | `<head>` 内加 FOUC 防闪脚本 |
| `src/client/index.css` | 重写 | 令牌层：`:root` / `.dark` 变量、`@theme inline` 映射、`@keyframes`、reduced-motion 兜底 |
| `src/client/theme.ts` | 新建 | 主题三态解析与持久化；导出纯函数 `resolveDark` 与 `useTheme` |
| `src/client/utils/time.ts` | 新建 | `fmtTime`（从 `api.ts` 迁入）、`fmtShort`、`relativeTime` |
| `src/client/utils/validate.ts` | 新建 | `validateRepo`、`validateInputsJson` |
| `src/client/api.ts` | 改 | 移除 `fmtTime`（迁至 `utils/time.ts`），其余不动 |
| `src/client/ui/styles.ts` | 新建 | 表单控件共用的基础类名常量，收口三处重复的 `inputCls` |
| `src/client/ui/icons.ts` | 新建 | 全站图标唯一出口，从 `lucide-react` 按需再导出 |
| `src/client/ui/Button.tsx` | 新建 | 4 variant × 2 size，`loading` 自动禁用并显示 spinner |
| `src/client/ui/Input.tsx` `Select.tsx` `Textarea.tsx` | 新建 | 表单控件，共用 `styles.ts` |
| `src/client/ui/Field.tsx` | 新建 | label + hint + error 容器，串联 `htmlFor` / `aria-describedby` / `aria-invalid` |
| `src/client/ui/Card.tsx` | 新建 | 面板容器，`interactive` 时悬停变边框与背景 |
| `src/client/ui/Badge.tsx` | 新建 | 语义徽章，4 种 tone |
| `src/client/ui/Switch.tsx` | 新建 | `role="switch"` + `aria-checked` 的开关 |
| `src/client/ui/Segmented.tsx` | 新建 | 分段控件，`role="radiogroup"`；被调度类型、触发方式、运行状态筛选三处复用 |
| `src/client/ui/Dialog.tsx` | 新建 | 原生 `<dialog>` 底座 |
| `src/client/ui/ConfirmDialog.tsx` | 新建 | `ConfirmProvider` + `useConfirm()` 命令式确认 |
| `src/client/ui/Drawer.tsx` | 新建 | 右侧抽屉，Esc 关闭、脏态二次确认 |
| `src/client/ui/Menu.tsx` | 新建 | `⋯` 下拉菜单，键盘可达 |
| `src/client/ui/Skeleton.tsx` | 新建 | `Skeleton` / `SkeletonText` / `SkeletonCard` |
| `src/client/ui/EmptyState.tsx` | 新建 | 空态 |
| `src/client/ui/index.ts` | 新建 | 原语统一出口，页面只从这里 import |
| `src/client/components/Toast.tsx` | 改 | 加进出场动画与手动关闭按钮 |
| `src/client/components/Layout.tsx` | 重写 | 响应式导航（桌面固定栏 / 窄屏抽屉）、计数徽章、主题切换、退出 |
| `src/client/components/ThemeToggle.tsx` | 新建 | 三态主题切换控件 |
| `src/client/components/PageHeader.tsx` | 新建 | 标题 + 说明 + 右侧操作插槽 |
| `src/client/components/RequireAuth.tsx` | 改 | **仅换配色令牌 + 加小 spinner。不得改为渲染骨架屏**（见 Task 5 说明） |
| `src/client/App.tsx` | 改 | 增挂 `ConfirmProvider` |
| `src/client/pages/Jobs.tsx` | 删除 | 拆入 `pages/Jobs/` |
| `src/client/pages/Jobs/index.tsx` | 新建 | 数据拉取、列表渲染、增删改编排 |
| `src/client/pages/Jobs/JobRow.tsx` | 新建 | 单任务列表行卡片 |
| `src/client/pages/Jobs/JobForm.tsx` | 新建 | 抽屉内表单，分三组 + 即时校验 |
| `src/client/pages/Jobs/ScheduleEditor.tsx` | 新建 | 调度规则编辑器 |
| `src/client/pages/Jobs/schedule.ts` | 新建 | 纯函数 `parseSchedule`、`describeLocal` |
| `src/client/pages/Dashboard.tsx` | 重写 | 统计卡 + 时间线 + 骨架 |
| `src/client/pages/Accounts.tsx` | 删除 | 拆成下面两个文件 |
| `src/client/pages/Accounts/index.tsx` | 新建 | 列表、就地添加面板、验证/删除编排 |
| `src/client/pages/Accounts/AccountCard.tsx` | 新建 | 单个账号卡片：查看态与就地编辑态（两态同源，放一起） |
| `src/client/pages/Runs.tsx` | 重写 | 分段筛选 + URL query + 状态色带 |
| `src/client/pages/Login.tsx` | 重写 | 精修 + 抖动动画 + 主题切换 |
| `test/client-theme.test.ts` | 新建 | `resolveDark` |
| `test/client-time.test.ts` | 新建 | `relativeTime`、`fmtShort` |
| `test/client-validate.test.ts` | 新建 | `validateRepo`、`validateInputsJson` |
| `test/client-schedule.test.ts` | 新建 | `parseSchedule`、`describeLocal` |

---

### Task 1: 令牌层、主题模块与首屏防闪

**Files:**
- Rewrite: `src/client/index.css`
- Create: `src/client/theme.ts`
- Create: `test/client-theme.test.ts`
- Modify: `index.html`（`<head>` 内加脚本）

**Interfaces:**
- Produces:
  - `export type ThemePref = "system" | "light" | "dark"`
  - `export function resolveDark(pref: ThemePref, systemDark: boolean): boolean`
  - `export function readThemePref(): ThemePref`
  - `export function applyTheme(pref: ThemePref): void`
  - `export function useTheme(): { pref: ThemePref; setPref: (p: ThemePref) => void }`
  - 语义颜色工具类：`bg-surface` `bg-panel` `bg-panel-hover` `border-border` `border-border-strong` `text-fg` `text-fg-muted` `text-fg-subtle` `text-accent` `bg-accent` `text-success` `bg-success-soft` `text-danger` `bg-danger-soft` `text-warn` `bg-warn-soft`
  - 动效工具类：`duration-fast` `duration-base` `duration-slow` `ease-smooth`
  - 动画类：`animate-in-pop` `animate-in-right` `animate-in-left` `animate-fade-in` `animate-shake` `animate-pulse-soft`

- [ ] **Step 1: 写失败的测试**

创建 `test/client-theme.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { resolveDark } from "../src/client/theme";

describe("resolveDark", () => {
  it("light 偏好始终为浅色，忽略系统", () => {
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("light", false)).toBe(false);
  });
  it("dark 偏好始终为深色，忽略系统", () => {
    expect(resolveDark("dark", true)).toBe(true);
    expect(resolveDark("dark", false)).toBe(true);
  });
  it("system 偏好跟随系统", () => {
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/client-theme.test.ts`
Expected: FAIL，报错内容为无法解析模块 `../src/client/theme`（文件还不存在）

- [ ] **Step 3: 写 `src/client/theme.ts`**

```ts
import { useCallback, useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

const KEY = "theme";
const MQ = "(prefers-color-scheme: dark)";

/** 纯函数：把用户偏好和系统状态解析为「是否深色」。唯一可单测的部分。 */
export function resolveDark(pref: ThemePref, systemDark: boolean): boolean {
  if (pref === "dark") return true;
  if (pref === "light") return false;
  return systemDark;
}

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // localStorage 被禁用（隐私模式）时退回 system，不抛错
  }
  return "system";
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.classList.toggle("dark", resolveDark(pref, matchMedia(MQ).matches));
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readThemePref);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try { localStorage.setItem(KEY, p); } catch { /* 同上 */ }
    applyTheme(p);
  }, []);

  // system 态下跟随系统实时变化
  useEffect(() => {
    if (pref !== "system") return;
    const mq = matchMedia(MQ);
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  return { pref, setPref };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/client-theme.test.ts`
Expected: PASS，3 个用例全绿

- [ ] **Step 5: 重写 `src/client/index.css`**

整个文件替换为（当前只有一行 `@import "tailwindcss";`）：

```css
@import "tailwindcss";

/* 深色模式改为 class 驱动。缺这一行，.dark 类不生效，手动切换无效。 */
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --surface: #fafafa;
  --panel: #ffffff;
  --panel-hover: #f5f5f5;
  --border: #e5e5e5;
  --border-strong: #d4d4d4;
  --fg: #0a0a0a;
  --fg-muted: #737373;
  --fg-subtle: #a3a3a3;
  --accent: #4f46e5;
  --success: #059669;
  --success-soft: #ecfdf5;
  --danger: #dc2626;
  --danger-soft: #fef2f2;
  --warn: #d97706;
  --warn-soft: #fffbeb;
}

.dark {
  --surface: #09090b;
  --panel: #131316;
  --panel-hover: #1c1c21;
  --border: #26262b;
  --border-strong: #3f3f46;
  --fg: #fafafa;
  --fg-muted: #8f8f99;
  --fg-subtle: #62626b;
  --accent: #818cf8;
  --success: #34d399;
  --success-soft: #052e23;
  --danger: #f87171;
  --danger-soft: #2c1214;
  --warn: #fbbf24;
  --warn-soft: #2b1d05;
}
```

接着在同一文件里追加：

```css
/* 必须是 @theme inline。普通 @theme 会在构建期把 var() 求值烧死，.dark 覆盖将失效。 */
@theme inline {
  --color-surface: var(--surface);
  --color-panel: var(--panel);
  --color-panel-hover: var(--panel-hover);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-fg: var(--fg);
  --color-fg-muted: var(--fg-muted);
  --color-fg-subtle: var(--fg-subtle);
  --color-accent: var(--accent);
  --color-success: var(--success);
  --color-success-soft: var(--success-soft);
  --color-danger: var(--danger);
  --color-danger-soft: var(--danger-soft);
  --color-warn: var(--warn);
  --color-warn-soft: var(--warn-soft);

  --ease-smooth: cubic-bezier(0.32, 0.72, 0, 1);
  /* 必须是 --transition-duration-*，不是 --duration-*。Tailwind v4 的 duration-* */
  /* 功能类只从 --transition-duration 命名空间解析；写成 --duration-* 时变量会输出到 */
  /* :root，但 .duration-fast 这个类根本不会生成，过渡会静默回落到默认时长。 */
  --transition-duration-fast: 120ms;
  --transition-duration-base: 180ms;
  --transition-duration-slow: 240ms;

  --animate-in-pop: in-pop var(--transition-duration-base) var(--ease-smooth);
  --animate-in-right: in-right var(--transition-duration-slow) var(--ease-smooth);
  --animate-in-left: in-left var(--transition-duration-slow) var(--ease-smooth);
  --animate-fade-in: fade-in var(--transition-duration-base) var(--ease-smooth);
  --animate-shake: shake 160ms ease-in-out;
  --animate-pulse-soft: pulse-soft 1.5s ease-in-out infinite;
}

@keyframes in-pop {
  from { opacity: 0; transform: scale(0.96) translateY(4px); }
  to   { opacity: 1; transform: none; }
}
@keyframes in-right {
  from { transform: translateX(100%); }
  to   { transform: none; }
}
@keyframes in-left {
  from { transform: translateX(-100%); }
  to   { transform: none; }
}
@keyframes fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25%      { transform: translateX(-4px); }
  75%      { transform: translateX(4px); }
}
@keyframes pulse-soft {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}

@layer base {
  body { @apply bg-surface text-fg; }
  /* 数字不跳动 */
  .tnum { font-variant-numeric: tabular-nums; }
  /* 原生 dialog 的遮罩 */
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

`--animate-*` 令牌让 `animate-in-pop`、`animate-in-right`、`animate-in-left`、`animate-fade-in`、`animate-shake`、`animate-pulse-soft` 成为可用的工具类，`--transition-duration-*` 让 `duration-fast/base/slow` 可用，`--ease-smooth` 让 `ease-smooth` 可用。

三个时长令牌的命名空间**必须**是 `--transition-duration-*`。这一条在 Tailwind v4.3.3 上实测过：写成 `--duration-*` 时变量会正常输出到 `:root`，`--animate-*` 里的 `var()` 也能解析，但构建产物里**一条 `.duration-fast` 规则都没有**——`duration-*` 功能类只查 `--transition-duration` 命名空间。这是静默失败，不报错，只是过渡时长回落到默认值。验收方式：构建后 `grep '\.duration-base{' dist/client/assets/*.css` 必须有输出。

对照：缓动的命名空间就是 `--ease-*`（不是 `--transition-timing-function-*`），所以 `--ease-smooth` 是对的。两者不对称，别类推。

- [ ] **Step 6: 在 `index.html` 加首屏防闪脚本**

把 `index.html` 的 `<head>` 改为（在 `</head>` 前插入 `<script>`）：

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Actions Cronhub</title>
    <script>
      // 必须内联在 head 内、React 挂载前执行。否则深色模式用户每次刷新都先闪一帧白屏。
      try {
        var t = localStorage.getItem("theme") || "system";
        if (t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches)) {
          document.documentElement.classList.add("dark");
        }
      } catch (e) {}
    </script>
  </head>
```

脚本里的 key（`"theme"`）与深色 class 名（`"dark"`）必须和 `theme.ts` 里的 `KEY` 与 `applyTheme` 完全一致。

- [ ] **Step 7: 类型检查、测试、构建**

Run:
```bash
npm run typecheck && npm test && npm run build
```
Expected：
- typecheck 无输出（通过）
- `npm test` 全绿，用例数比重构前多 3 个（新增的 `resolveDark`）
- build 成功，产物写入 `dist/`

再对构建产物做一次机器核验——令牌层是否真的生成了工具类，只有产物能证明：

Run:
```bash
grep -c '\.duration-fast{\|\.duration-base{\|\.duration-slow{' dist/client/assets/*.css
grep -c '\.ease-smooth{' dist/client/assets/*.css
grep -o '\.bg-panel{[^}]*}' dist/client/assets/*.css
grep -c '^\.dark,\|\.dark{' dist/client/assets/*.css
```
Expected：
- 第一条输出 `3`（三个时长类都生成了）。若输出 `0`，说明命名空间写错了，回到 Step 5 检查是不是写成了 `--duration-*`
- 第二条输出 `1`
- 第三条输出 `.bg-panel{background-color:var(--panel)}` —— **必须是 `var(--panel)` 而不是 `#ffffff`**，否则 `@theme inline` 没生效，`.dark` 覆盖会失效
- 第四条大于 `0`

- [ ] **Step 8: 人工核验**

Run `npm run dev`，打开 `http://localhost:5173`：

- [ ] 页面背景是 `--surface`（浅色 `#fafafa`），不是纯白 —— 说明 `@theme inline` 生效
- [ ] 浏览器 DevTools 里在 `<html>` 上手动加 `class="dark"`，页面立刻变深色；移除后变回浅色 —— 说明 `@custom-variant` 生效
- [ ] 在 Console 执行 `localStorage.setItem("theme","dark")` 后刷新，**整个加载过程没有任何白色闪帧**

（此时页面样式仍是旧的，只验证令牌层与防闪脚本。）

- [ ] **Step 9: 提交**

```bash
git add src/client/index.css src/client/theme.ts test/client-theme.test.ts index.html
git commit -m "feat: 设计令牌层与 class 驱动的主题切换基础"
```

---

### Task 2: 前端纯逻辑与单测

把页面里将要用到的、不依赖 DOM 的逻辑先抽成纯函数并测掉。后面的组件任务没法自动测，这一任务是本计划里唯一能建立回归保护的地方，别跳。

**Files:**
- Create: `src/client/utils/time.ts`
- Create: `src/client/utils/validate.ts`
- Create: `src/client/pages/Jobs/schedule.ts`
- Create: `test/client-time.test.ts`, `test/client-validate.test.ts`, `test/client-schedule.test.ts`
- Modify: `src/client/api.ts`（移出 `fmtTime`）

**Interfaces:**
- Consumes: `src/client/types.ts` 的 `Schedule` 类型（已存在，不改）
- Produces:
  - `time.ts`: `fmtTime(ms?: number | null): string`、`fmtShort(ms?: number | null): string`、`relativeTime(ms: number | null | undefined, now?: number): string`
  - `validate.ts`: `validateRepo(v: string): string | null`、`validateInputsJson(v: string): string | null`（返回 `null` 表示合法，否则返回中文错误文案）
  - `Jobs/schedule.ts`: `EMPTY_SCHEDULE: Schedule`、`parseSchedule(json: string): Schedule`、`describeLocal(s: Schedule): string`

- [ ] **Step 1: 写 `test/client-time.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fmtShort, relativeTime } from "../src/client/utils/time";

const NOW = Date.UTC(2026, 7, 31, 6, 0, 0); // 2026-08-31 06:00 UTC

describe("relativeTime", () => {
  it("空值返回短横线", () => {
    expect(relativeTime(null, NOW)).toBe("-");
    expect(relativeTime(undefined, NOW)).toBe("-");
  });
  it("一分钟内的过去是刚刚", () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe("刚刚");
  });
  it("一分钟内的未来是即将", () => {
    expect(relativeTime(NOW + 30_000, NOW)).toBe("即将");
  });
  it("过去用前缀后缀「前」", () => {
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5 分钟前");
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe("2 小时前");
    expect(relativeTime(NOW - 3 * 86_400_000, NOW)).toBe("3 天前");
  });
  it("未来用后缀「后」", () => {
    expect(relativeTime(NOW + 45 * 60_000, NOW)).toBe("45 分钟后");
    expect(relativeTime(NOW + 2 * 3_600_000, NOW)).toBe("2 小时后");
    expect(relativeTime(NOW + 10 * 86_400_000, NOW)).toBe("10 天后");
  });
  it("向下取整，不四舍五入", () => {
    expect(relativeTime(NOW + 119 * 60_000, NOW)).toBe("1 小时后");
  });
});

describe("fmtShort", () => {
  it("空值返回短横线", () => {
    expect(fmtShort(null)).toBe("-");
  });
  it("输出 MM-DD HH:mm，不含年和秒", () => {
    expect(fmtShort(new Date(2026, 7, 31, 14, 30, 5).getTime())).toBe("08-31 14:30");
  });
});
```

`fmtShort` 用本地时区，所以测试里用 `new Date(y, m, d, ...)` 构造（本地时间），不用 `Date.UTC`。`relativeTime` 只做差值运算，与时区无关，用 `Date.UTC` 构造更稳。

- [ ] **Step 2: 写 `test/client-validate.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { validateRepo, validateInputsJson } from "../src/client/utils/validate";

describe("validateRepo", () => {
  it("合法 owner/repo 返回 null", () => {
    expect(validateRepo("alice/repo1")).toBeNull();
    expect(validateRepo("my-org/my.repo_2")).toBeNull();
  });
  it("空值报错", () => {
    expect(validateRepo("")).toBe("仓库不能为空");
    expect(validateRepo("   ")).toBe("仓库不能为空");
  });
  it("缺少斜杠或多余斜杠报错", () => {
    expect(validateRepo("repo1")).toBe("格式应为 owner/repo");
    expect(validateRepo("a/b/c")).toBe("格式应为 owner/repo");
  });
  it("含非法字符报错", () => {
    expect(validateRepo("ali ce/repo")).toBe("格式应为 owner/repo");
    expect(validateRepo("https://github.com/a/b")).toBe("格式应为 owner/repo");
  });
});

describe("validateInputsJson", () => {
  it("留空是合法的", () => {
    expect(validateInputsJson("")).toBeNull();
    expect(validateInputsJson("  \n ")).toBeNull();
  });
  it("合法 JSON 对象返回 null", () => {
    expect(validateInputsJson('{"environment":"prod"}')).toBeNull();
    expect(validateInputsJson("{}")).toBeNull();
  });
  it("语法错误报错", () => {
    expect(validateInputsJson("{foo}")).toBe("不是合法的 JSON");
    expect(validateInputsJson('{"a":1,}')).toBe("不是合法的 JSON");
  });
  it("合法 JSON 但不是对象要报错", () => {
    expect(validateInputsJson("[1,2]")).toBe("必须是 JSON 对象，不能是数组或基本类型");
    expect(validateInputsJson("123")).toBe("必须是 JSON 对象，不能是数组或基本类型");
    expect(validateInputsJson('"str"')).toBe("必须是 JSON 对象，不能是数组或基本类型");
    expect(validateInputsJson("null")).toBe("必须是 JSON 对象，不能是数组或基本类型");
  });
});
```

- [ ] **Step 3: 写 `test/client-schedule.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { EMPTY_SCHEDULE, parseSchedule, describeLocal } from "../src/client/pages/Jobs/schedule";

describe("parseSchedule", () => {
  it("解析合法 JSON", () => {
    expect(parseSchedule('{"type":"cron","expr":"30 3 * * *"}'))
      .toEqual({ type: "cron", expr: "30 3 * * *" });
  });
  it("非法 JSON 兜底为默认间隔规则，不抛错", () => {
    expect(parseSchedule("{坏数据")).toEqual(EMPTY_SCHEDULE);
    expect(parseSchedule("")).toEqual(EMPTY_SCHEDULE);
  });
  it("合法 JSON 但不是对象也兜底", () => {
    expect(parseSchedule("42")).toEqual(EMPTY_SCHEDULE);
    expect(parseSchedule("null")).toEqual(EMPTY_SCHEDULE);
  });
});

describe("describeLocal", () => {
  it("cron 规则标注 UTC", () => {
    expect(describeLocal({ type: "cron", expr: "30 3 * * *" })).toBe("cron 30 3 * * *（UTC）");
  });
  it("固定间隔", () => {
    expect(describeLocal({ type: "interval", mode: "fixed", value: 45, unit: "m" })).toBe("每 45 分钟");
    expect(describeLocal({ type: "interval", mode: "fixed", value: 6, unit: "h" })).toBe("每 6 小时");
  });
  it("随机间隔", () => {
    expect(describeLocal({ type: "interval", mode: "random", min: 30, max: 90, unit: "m" }))
      .toBe("每 30~90 分钟（随机）");
  });
  it("缺字段时不崩，按默认单位处理", () => {
    expect(describeLocal({ type: "cron" })).toBe("cron（UTC）");
    expect(describeLocal({ type: "interval", mode: "fixed", value: 5 })).toBe("每 5 分钟");
  });
});
```

- [ ] **Step 4: 运行三个测试文件确认全部失败**

Run:
```bash
npx vitest run test/client-time.test.ts test/client-validate.test.ts test/client-schedule.test.ts
```
Expected: 三个文件全部 FAIL，报错为无法解析对应模块（`utils/time`、`utils/validate`、`pages/Jobs/schedule` 都还不存在）

- [ ] **Step 5: 写 `src/client/utils/time.ts`**

```ts
export const fmtTime = (ms?: number | null): string =>
  ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "-";

/** MM-DD HH:mm，用于列表里的紧凑显示 */
export function fmtShort(ms?: number | null): string {
  if (!ms) return "-";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/** 相对时间。now 参数仅供测试注入。 */
export function relativeTime(ms: number | null | undefined, now: number = Date.now()): string {
  if (!ms) return "-";
  const diff = ms - now;
  const abs = Math.abs(diff);
  const future = diff > 0;
  if (abs < MIN) return future ? "即将" : "刚刚";
  const [n, unit] =
    abs < HOUR ? [Math.floor(abs / MIN), "分钟"] :
    abs < DAY  ? [Math.floor(abs / HOUR), "小时"] :
                 [Math.floor(abs / DAY), "天"];
  return `${n} ${unit}${future ? "后" : "前"}`;
}
```

- [ ] **Step 6: 写 `src/client/utils/validate.ts`**

```ts
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** 合法返回 null，否则返回中文错误文案。 */
export function validateRepo(v: string): string | null {
  if (!v.trim()) return "仓库不能为空";
  return REPO_RE.test(v.trim()) ? null : "格式应为 owner/repo";
}

/** 留空视为合法（inputs 是可选的）。 */
export function validateInputsJson(v: string): string | null {
  if (!v.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    return "不是合法的 JSON";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "必须是 JSON 对象，不能是数组或基本类型";
  }
  return null;
}
```

- [ ] **Step 7: 写 `src/client/pages/Jobs/schedule.ts`**

需要先建目录 `src/client/pages/Jobs/`。这一步只放纯函数，组件在 Task 7 迁入。

```ts
import type { Schedule } from "../../types";

export const EMPTY_SCHEDULE: Schedule = { type: "interval", mode: "fixed", value: 45, unit: "m" };

const UNIT_NAME: Record<string, string> = { m: "分钟", h: "小时", d: "天" };

/** 解析后端存的 schedule_json。任何异常输入都兜底为 EMPTY_SCHEDULE，绝不抛错。 */
export function parseSchedule(json: string): Schedule {
  try {
    const v = JSON.parse(json) as unknown;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return EMPTY_SCHEDULE;
    return v as Schedule;
  } catch {
    return EMPTY_SCHEDULE;
  }
}

/** 人类可读的调度描述。cron 明确标注 UTC，因为后端按 UTC 计算。 */
export function describeLocal(s: Schedule): string {
  if (s.type === "cron") return s.expr ? `cron ${s.expr}（UTC）` : "cron（UTC）";
  const u = UNIT_NAME[s.unit ?? "m"];
  if (s.mode === "random") return `每 ${s.min}~${s.max} ${u}（随机）`;
  return `每 ${s.value} ${u}`;
}
```

这里刻意与服务端 `src/server/schedule.ts` 的 `describeSchedule` 保持两份实现，不复用：服务端接收的是校验过的严格 `ScheduleRule`，客户端处理的是编辑中字段可缺的宽松 `Schedule`；而且服务端模块 import 了 `./cron`，复用会把 cron 解析器打进前端产物。

- [ ] **Step 8: 运行测试确认全部通过**

Run:
```bash
npx vitest run test/client-time.test.ts test/client-validate.test.ts test/client-schedule.test.ts
```
Expected: PASS，共 23 个用例（time.test.ts 8 个、validate.test.ts 8 个、schedule.test.ts 7 个）

- [ ] **Step 9: 从 `api.ts` 移出 `fmtTime` 并修好四处 import**

删除 `src/client/api.ts` 末尾这两行：

```ts
export const fmtTime = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "-";
```

然后逐一改这四个文件的第 2 行 import（现在都从 `../api` 取 `fmtTime`）：

| 文件 | 改前 | 改后 |
|---|---|---|
| `pages/Dashboard.tsx` | `import { fmtTime, get } from "../api";` | `import { get } from "../api";`<br>`import { fmtTime } from "../utils/time";` |
| `pages/Jobs.tsx` | `import { del, fmtTime, get, post, put } from "../api";` | `import { del, get, post, put } from "../api";`<br>`import { fmtTime } from "../utils/time";` |
| `pages/Accounts.tsx` | `import { del, fmtTime, get, post, put } from "../api";` | `import { del, get, post, put } from "../api";`<br>`import { fmtTime } from "../utils/time";` |
| `pages/Runs.tsx` | `import { fmtTime, get, post } from "../api";` | `import { get, post } from "../api";`<br>`import { fmtTime } from "../utils/time";` |

这四个页面本任务不做其他改动，只是让 build 保持绿色，它们会在 Task 7-11 被重写。

- [ ] **Step 10: 全量验证**

Run:
```bash
npm run typecheck && npm test && npm run build
```
Expected: typecheck 无输出；`npm test` 全绿；build 成功。如果 typecheck 报某个页面找不到 `fmtTime`，说明 Step 9 漏了一处。

- [ ] **Step 11: 提交**

```bash
git add src/client/utils src/client/pages/Jobs src/client/api.ts src/client/pages/*.tsx test/client-*.test.ts
git commit -m "refactor: 抽出前端纯逻辑（时间、校验、调度描述）并补单测"
```

---

### Task 3: UI 原语（一）——基础控件

**Files:**
- Modify: `package.json`（新增 `lucide-react`）
- Create: `src/client/ui/styles.ts`, `icons.ts`, `Button.tsx`, `Input.tsx`, `Select.tsx`, `Textarea.tsx`, `Field.tsx`, `Card.tsx`, `Badge.tsx`, `Switch.tsx`, `Segmented.tsx`, `index.ts`

**Interfaces:**
- Consumes: Task 1 的语义颜色类与 `duration-*` / `ease-smooth` 工具类
- Produces:
  - `styles.ts`: `controlBase: string`、`controlError: string`、`cx(...parts: (string | false | null | undefined)[]): string`
  - `Button`: `props = { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>`
  - `Input` / `Textarea` / `Select`: 原生 props + `invalid?: boolean`，`Select` 另有 `children`
  - `Field`: `{ label: string; hint?: string; error?: string | null; children: (ids: { id: string; describedBy?: string }) => ReactNode }`（children 是 render prop，见 Step 7）
  - `Card`: `{ interactive?: boolean; className?: string; children: ReactNode }`
  - `Badge`: `{ tone?: "success" | "danger" | "warn" | "neutral"; icon?: ReactNode; children: ReactNode }`
  - `Switch`: `{ checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }`
  - `Segmented`: `<T extends string>(props: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string })`
  - `index.ts` 汇总导出上述全部（含后续 Task 4、5 的原语）

- [ ] **Step 1: 安装 lucide-react（精确版本）**

Run:
```bash
npm install --save-exact lucide-react@1.37.0
```
Expected: `package.json` 的 `dependencies` 出现 `"lucide-react": "1.37.0"`（无 `^`）

- [ ] **Step 2: 校验计划里用到的图标名在该版本中都存在**

lucide 历史上改过名（`CheckCircle2`→`CircleCheck`、`XCircle`→`CircleX`、`AlertCircle`→`CircleAlert`、`Loader2`→`LoaderCircle`），先验证再写代码，省得逐个 typecheck 试错。

Run:
```bash
node --input-type=module -e "
import * as I from 'lucide-react';
const want = ['LayoutDashboard','Users','Clock','ScrollText','Plus','Pencil','Trash2','Play','RefreshCw','MoreHorizontal','X','Check','ChevronLeft','ChevronRight','ChevronDown','Menu','Sun','Moon','Monitor','CircleCheck','CircleX','CircleAlert','LoaderCircle','GitBranch','Timer','ArrowRight','Inbox','KeyRound','LogOut'];
const miss = want.filter(n => !(n in I));
console.log(miss.length ? 'MISSING: ' + miss.join(', ') : '全部图标名有效');
"
```
Expected: 输出 `全部图标名有效`。

若输出 MISSING，用这张对照表换名，并同步改 Step 3 的 `icons.ts`：

| 计划用名 | 旧名备选 |
|---|---|
| `CircleCheck` | `CheckCircle2` / `CheckCircle` |
| `CircleX` | `XCircle` |
| `CircleAlert` | `AlertCircle` |
| `LoaderCircle` | `Loader2` |
| `Monitor` | `MonitorSmartphone` |

- [ ] **Step 3: 写 `src/client/ui/icons.ts`**

全站图标唯一出口。页面和组件**只能**从这里 import 图标，不许直接 import `lucide-react`——这样换图标库或改名只需动一个文件。

```ts
export {
  // 导航
  LayoutDashboard, Users, Clock, ScrollText,
  // 操作
  Plus, Pencil, Trash2, Play, RefreshCw, MoreHorizontal, X, Check,
  ChevronLeft, ChevronRight, ChevronDown, Menu,
  // 主题
  Sun, Moon, Monitor,
  // 状态
  CircleCheck, CircleX, CircleAlert, LoaderCircle,
  // 领域
  GitBranch, Timer, ArrowRight, Inbox, KeyRound, LogOut,
} from "lucide-react";
export type { LucideIcon } from "lucide-react";
```

- [ ] **Step 4: 写 `src/client/ui/styles.ts`**

```ts
/** 极简 className 拼接。刻意不装 clsx —— 只需要这 3 行。 */
export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(" ");

/** 所有表单控件共用。收口原先散在 Jobs / Accounts / Login 三处的 inputCls。 */
export const controlBase = cx(
  "w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-fg",
  "placeholder:text-fg-subtle",
  "transition-colors duration-fast ease-smooth",
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

export const controlError = "border-danger focus:border-danger focus:ring-danger/30";
```

- [ ] **Step 5: 写 `src/client/ui/Button.tsx`**

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "./icons";
import { cx } from "./styles";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  // 主按钮近黑：浅色下深底白字，深色下反转为白底黑字
  primary: "bg-fg text-surface hover:opacity-85",
  secondary: "border border-border bg-panel text-fg hover:bg-panel-hover hover:border-border-strong",
  ghost: "text-fg-muted hover:bg-panel-hover hover:text-fg",
  danger: "border border-danger/40 bg-danger-soft text-danger hover:border-danger",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = "secondary", size = "md", loading = false,
  icon, children, className, disabled, type = "button", ...rest
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-medium",
        "transition-all duration-fast ease-smooth",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant], SIZES[size], className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
```

`loading` 时自动 `disabled`，避免重复提交；`aria-busy` 让读屏软件知道在处理中。

- [ ] **Step 6: 写 `Input.tsx` / `Textarea.tsx` / `Select.tsx`**

`src/client/ui/Input.tsx`：

```tsx
import type { InputHTMLAttributes } from "react";
import { controlBase, controlError, cx } from "./styles";

type Props = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function Input({ invalid, className, ...rest }: Props) {
  return <input aria-invalid={invalid || undefined}
    className={cx(controlBase, invalid && controlError, className)} {...rest} />;
}
```

`src/client/ui/Textarea.tsx`：

```tsx
import type { TextareaHTMLAttributes } from "react";
import { controlBase, controlError, cx } from "./styles";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export function Textarea({ invalid, className, ...rest }: Props) {
  return <textarea aria-invalid={invalid || undefined}
    className={cx(controlBase, "resize-y", invalid && controlError, className)} {...rest} />;
}
```

`src/client/ui/Select.tsx`：

```tsx
import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "./icons";
import { controlBase, controlError, cx } from "./styles";

type Props = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export function Select({ invalid, className, children, ...rest }: Props) {
  return (
    <div className="relative">
      <select aria-invalid={invalid || undefined}
        className={cx(controlBase, "appearance-none pr-9", invalid && controlError, className)} {...rest}>
        {children}
      </select>
      <ChevronDown aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-subtle" />
    </div>
  );
}
```

- [ ] **Step 7: 写 `src/client/ui/Field.tsx`**

```tsx
import { useId, type ReactNode } from "react";

type Props = {
  label: string;
  hint?: string;
  error?: string | null;
  children: (ids: { id: string; describedBy?: string }) => ReactNode;
};

/**
 * 表单行容器。children 是函数，把生成的 id 交给控件，
 * 保证 label 的 htmlFor 与 aria-describedby 始终串得上。
 */
export function Field({ label, hint, error, children }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = error ? errId : hint ? hintId : undefined;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg">{label}</label>
      {children({ id, describedBy })}
      {error
        ? <p id={errId} role="alert" className="mt-1.5 text-xs text-danger">{error}</p>
        : hint && <p id={hintId} className="mt-1.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}
```

用法（后续任务里就这么写）：

```tsx
<Field label="仓库（owner/repo）" hint="如 alice/repo1" error={errors.repo}>
  {({ id, describedBy }) => (
    <Input id={id} aria-describedby={describedBy} invalid={!!errors.repo}
      value={form.repo} onChange={e => setForm({ ...form, repo: e.target.value })} />
  )}
</Field>
```

- [ ] **Step 8: 写 `Card.tsx` / `Badge.tsx` / `Switch.tsx` / `Segmented.tsx`**

`src/client/ui/Card.tsx`：

```tsx
import type { ReactNode } from "react";
import { cx } from "./styles";

type Props = { interactive?: boolean; className?: string; children: ReactNode };

export function Card({ interactive, className, children }: Props) {
  return (
    <div className={cx(
      "rounded-xl border border-border bg-panel",
      // 悬停只改颜色，不做位移抬升 —— 密集列表里逐个跳动是视觉噪音
      interactive && "transition-colors duration-fast ease-smooth hover:border-border-strong hover:bg-panel-hover",
      className,
    )}>
      {children}
    </div>
  );
}
```

`src/client/ui/Badge.tsx`：

```tsx
import type { ReactNode } from "react";
import { cx } from "./styles";

type Tone = "success" | "danger" | "warn" | "neutral";

const TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
  neutral: "bg-panel-hover text-fg-muted",
};

export function Badge({ tone = "neutral", icon, children }:
  { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cx(
      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
      TONES[tone],
    )}>
      {icon}
      {children}
    </span>
  );
}
```

`shrink-0` + `whitespace-nowrap` 保留原有修复：徽章在窄容器里不被挤压变形（见 commit `6da023e`）。

`src/client/ui/Switch.tsx`：

```tsx
import { cx } from "./styles";

type Props = { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string };

/** 原实现是裸 <button>，读屏软件读不出状态。这里补齐 role 与 aria-checked。 */
export function Switch({ checked, onChange, disabled, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-fast ease-smooth",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-success" : "bg-border-strong",
      )}
    >
      <span className={cx(
        "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm",
        "transition-transform duration-fast ease-smooth",
        checked && "translate-x-4",
      )} />
    </button>
  );
}
```

滑块改用 `absolute` + `translate-x`，取代原来 `translate-y-0.5` 混着 `ml-0.5` 的写法——原写法在不同字号下会错位。

`src/client/ui/Segmented.tsx`：

```tsx
import { cx } from "./styles";

type Props<T extends string> = {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  /** 给读屏软件用，如「调度类型」 */
  label: string;
};

export function Segmented<T extends string>({ value, onChange, options, label }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={label}
      className="inline-flex gap-0.5 rounded-lg border border-border bg-surface p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md px-3 py-1.5 text-sm whitespace-nowrap",
            "transition-colors duration-fast ease-smooth",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
            value === o.value ? "bg-panel font-medium text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

三处会用它：调度类型（间隔 / cron）、触发方式（`workflow_dispatch` / `repository_dispatch`）、运行记录状态筛选（全部 / 成功 / 失败）。取代原先三处各写一遍的 `bg-indigo-600 text-white` 实心按钮组。

Task 6 的 `ThemeToggle` 刻意**不**复用它：那里是三个等宽纯图标按钮、每项要独立 `aria-label` 与 `title`，套进来得给 `Segmented` 加 `icon`、`iconOnly`、`fill` 三个只有一处使用的参数，不值得。

- [ ] **Step 9: 写 `src/client/ui/index.ts`**

Task 3 阶段只导出已存在的原语，Task 4、5 会各自追加一行。

```ts
export { cx, controlBase, controlError } from "./styles";
export { Button } from "./Button";
export { Input } from "./Input";
export { Textarea } from "./Textarea";
export { Select } from "./Select";
export { Field } from "./Field";
export { Card } from "./Card";
export { Badge } from "./Badge";
export { Switch } from "./Switch";
export { Segmented } from "./Segmented";
```

- [ ] **Step 10: 验证**

Run:
```bash
npm run typecheck && npm test && npm run build
```
Expected: typecheck 无输出；`npm test` 全绿（23 个前端用例 + 原有服务端用例）；build 成功。

原语此时还没被任何页面消费，Vite 会把它们 tree-shake 掉，所以 build 产物体积不会明显变化——这是正常的，不是没编译。

- [ ] **Step 11: 提交**

```bash
git add package.json package-lock.json src/client/ui
git commit -m "feat: UI 原语基础控件（Button/Input/Select/Field/Card/Badge/Switch/Segmented）"
```

---

### Task 4: UI 原语（二）——弹层

**Files:**
- Create: `src/client/ui/Dialog.tsx`, `ConfirmDialog.tsx`, `Drawer.tsx`, `Menu.tsx`
- Modify: `src/client/ui/index.ts`, `src/client/App.tsx`

**Interfaces:**
- Consumes: Task 3 的 `Button`、`cx`、`icons`
- Produces:
  - `Dialog`: `{ open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: string }`
  - `ConfirmProvider`: `{ children: ReactNode }`
  - `useConfirm(): (opts: ConfirmOptions) => Promise<boolean>`，其中
    `type ConfirmOptions = { title: string; description?: string; confirmText?: string; cancelText?: string; tone?: "danger" | "primary" }`
  - `Drawer`: `{ open: boolean; onClose: () => void; title: string; dirty?: boolean; children: ReactNode }`
  - `Menu`: `{ label: string; items: MenuItem[] }`，其中
    `type MenuItem = { label: string; icon?: ReactNode; onSelect: () => void; tone?: "danger" }`

- [ ] **Step 1: 写 `src/client/ui/Dialog.tsx`**

```tsx
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "./icons";
import { cx } from "./styles";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
};

/**
 * 基于原生 <dialog>：焦点锁定、Esc 关闭、背景惰性化、::backdrop 全由浏览器提供，
 * 不需要手写焦点陷阱。
 */
export function Dialog({ open, onClose, title, children, footer, width = "max-w-md" }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // 浏览器触发的关闭（Esc、form method=dialog）要同步回 React 状态
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancelOrClose = (e: Event) => { e.preventDefault(); onClose(); };
    el.addEventListener("cancel", onCancelOrClose);
    return () => el.removeEventListener("cancel", onCancelOrClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={e => { if (e.target === ref.current) onClose(); }}
      className={cx(
        "m-auto w-full rounded-xl border border-border bg-panel p-0 text-fg shadow-xl",
        "open:animate-in-pop backdrop:bg-black/50",
        width,
      )}
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <h2 id={titleId} className="text-base font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="关闭"
          className="-m-1 rounded-md p-1 text-fg-subtle transition-colors duration-fast hover:bg-panel-hover hover:text-fg">
          <X className="size-4" />
        </button>
      </div>
      <div className="px-5 py-4 text-sm text-fg-muted">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
    </dialog>
  );
}
```

点击 `::backdrop` 关闭靠的是 `e.target === ref.current`：点在 `<dialog>` 自身（即遮罩区域）才关，点在内部子元素不关。

- [ ] **Step 2: 写 `src/client/ui/ConfirmDialog.tsx`**

命令式 API，因为要替换的三处 `confirm()` 都在 async 函数中间。

```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "primary";
};

type Resolver = (ok: boolean) => void;

const Ctx = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<Resolver | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    return new Promise<boolean>(resolve => { resolver.current = resolve; });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  }, []);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Dialog
        open={opts !== null}
        onClose={() => settle(false)}
        title={opts?.title ?? ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => settle(false)}>
              {opts?.cancelText ?? "取消"}
            </Button>
            <Button variant={opts?.tone === "danger" ? "danger" : "primary"} onClick={() => settle(true)}>
              {opts?.confirmText ?? "确定"}
            </Button>
          </>
        }
      >
        {opts?.description}
      </Dialog>
    </Ctx.Provider>
  );
}
```

关闭途径（Esc、点遮罩、点 X、点取消）全部 resolve 为 `false`，调用方只需 `if (!ok) return;`。

- [ ] **Step 3: 在 `App.tsx` 挂上 `ConfirmProvider`**

改 `src/client/App.tsx`，在 `ToastProvider` 内层包一层：

```tsx
import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import RequireAuth from "./components/RequireAuth";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider } from "./ui/ConfirmDialog";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Jobs from "./pages/Jobs";
import Accounts from "./pages/Accounts";
import Runs from "./pages/Runs";

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/runs" element={<Runs />} />
          </Route>
        </Routes>
      </ConfirmProvider>
    </ToastProvider>
  );
}
```

`ConfirmProvider` 在内层，这样确认弹窗里的错误也能弹 toast。`import Jobs from "./pages/Jobs"` 这一行不用改——Task 7 建 `pages/Jobs/index.tsx` 后该路径自动解析到目录。

- [ ] **Step 4: 写 `src/client/ui/Drawer.tsx`**

同样基于原生 `<dialog>`，只是靠右满高。这样焦点锁定和 Esc 免费拿到，与 `Dialog` 行为一致。

```tsx
import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { useConfirm } from "./ConfirmDialog";
import { X } from "./icons";
import { cx } from "./styles";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 有未保存改动。为 true 时 Esc 与点遮罩会先二次确认。 */
  dirty?: boolean;
  children: ReactNode;
};

export function Drawer({ open, onClose, title, dirty = false, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const confirm = useConfirm();

  const attemptClose = useCallback(async () => {
    if (!dirty) return onClose();
    const ok = await confirm({
      title: "放弃未保存的改动？",
      description: "关闭后本次填写的内容不会保存。",
      confirmText: "放弃",
      tone: "danger",
    });
    if (ok) onClose();
  }, [dirty, onClose, confirm]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => { e.preventDefault(); void attemptClose(); };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [attemptClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={e => { if (e.target === ref.current) void attemptClose(); }}
      className={cx(
        "mr-0 ml-auto h-full max-h-full w-120 max-w-full",
        "rounded-none border-l border-border bg-panel p-0 text-fg shadow-2xl",
        "open:animate-in-right backdrop:bg-black/50",
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={() => void attemptClose()} aria-label="关闭"
            className="-m-1 rounded-md p-1 text-fg-subtle transition-colors duration-fast hover:bg-panel-hover hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </dialog>
  );
}
```

宽度沿用原来的 `w-120`（Tailwind v4 的动态 spacing 刻度，等于 30rem），窄屏由 `max-w-full` 兜底为满宽。

- [ ] **Step 5: 写 `src/client/ui/Menu.tsx`**

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "./icons";
import { cx } from "./styles";

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: "danger";
};

export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // 点击外部与 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className={cx(
          "rounded-md p-1.5 text-fg-subtle transition-colors duration-fast",
          "hover:bg-panel-hover hover:text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          open && "bg-panel-hover text-fg",
        )}
      >
        <MoreHorizontal className="size-4" />
      </button>

      {open && (
        <div role="menu"
          className="animate-in-pop absolute right-0 z-20 mt-1 min-w-36 rounded-lg border border-border bg-panel p-1 shadow-lg">
          {items.map(it => (
            <button
              key={it.label}
              role="menuitem"
              type="button"
              onClick={() => { setOpen(false); it.onSelect(); }}
              className={cx(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
                "transition-colors duration-fast hover:bg-panel-hover",
                it.tone === "danger" ? "text-danger" : "text-fg",
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

菜单项是原生 `<button>`，Tab 与 Enter 天然可用；方向键导航刻意不实现——4 个以内的菜单项 Tab 足够，手写方向键管理容易出 bug 而收益很小。

- [ ] **Step 6: 追加 `src/client/ui/index.ts` 导出**

在 Task 3 建的文件末尾追加：

```ts
export { Dialog } from "./Dialog";
export { ConfirmProvider, useConfirm, type ConfirmOptions } from "./ConfirmDialog";
export { Drawer } from "./Drawer";
export { Menu, type MenuItem } from "./Menu";
```

- [ ] **Step 7: 验证**

Run:
```bash
npm run typecheck && npm test && npm run build
```
Expected: 三条全部通过。

- [ ] **Step 8: 提交**

```bash
git add src/client/ui src/client/App.tsx
git commit -m "feat: 弹层原语（Dialog/ConfirmDialog/Drawer/Menu），基于原生 dialog"
```

---

### Task 5: UI 原语（三）——骨架、空态、Toast

**Files:**
- Create: `src/client/ui/Skeleton.tsx`, `src/client/ui/EmptyState.tsx`
- Modify: `src/client/ui/index.ts`, `src/client/components/Toast.tsx`, `src/client/components/RequireAuth.tsx`

**Interfaces:**
- Consumes: Task 3 的 `cx`、`icons`、`Button`
- Produces:
  - `Skeleton`: `{ className?: string }`
  - `SkeletonText`: `{ lines?: number; className?: string }`
  - `SkeletonCard`: `{ className?: string }`
  - `EmptyState`: `{ icon: ReactNode; title: string; description?: string; action?: ReactNode }`
  - `useToast()` 签名不变：`(message: string, kind?: "ok" | "err") => void`

> **不要改 `RequireAuth` 的渲染策略。** 该文件第 4-5 行的注释和 commit `ac63621` 说明了原因：校验会话期间刻意不渲染任何后台 UI，否则未登录访问 `/jobs` 会先闪现页面骨架再跳登录页。这一任务里只允许把 `text-neutral-500` 换成 `text-fg-muted` 并加一个 spinner 图标，渲染逻辑一行不动。

- [ ] **Step 1: 写 `src/client/ui/Skeleton.tsx`**

```tsx
import { cx } from "./styles";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse-soft rounded-md bg-panel-hover", className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        // 最后一行短一些，更像真实文本
        <Skeleton key={i} className={cx("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cx("rounded-xl border border-border bg-panel p-4", className)}>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-7 w-12" />
    </div>
  );
}
```

外层容器要带 `aria-busy="true"`，骨架本身 `aria-hidden`，读屏软件才不会念出一串无意义节点。

- [ ] **Step 2: 写 `src/client/ui/EmptyState.tsx`**

```tsx
import type { ReactNode } from "react";

type Props = { icon: ReactNode; title: string; description?: string; action?: ReactNode };

export function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-panel-hover text-fg-subtle">
        {icon}
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 3: 升级 `src/client/components/Toast.tsx`**

保持 `useToast()` 签名不变（现有页面都在用），只加进出场动画、图标和手动关闭。整个文件替换为：

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, X } from "../ui/icons";
import { cx } from "../ui/styles";

type Kind = "ok" | "err";
type ToastItem = { id: number; message: string; kind: Kind };

const Ctx = createContext<(message: string, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((message: string, kind: Kind = "ok") => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev, { id, message, kind }]);
    setTimeout(() => dismiss(id), 3000);
  }, [dismiss]);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" aria-atomic="false"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {items.map(t => (
          <div key={t.id}
            className={cx(
              "animate-in-pop pointer-events-auto flex max-w-sm items-start gap-2.5",
              "rounded-lg border px-3.5 py-2.5 text-sm shadow-lg",
              t.kind === "ok"
                ? "border-success/30 bg-success-soft text-success"
                : "border-danger/30 bg-danger-soft text-danger",
            )}
          >
            {t.kind === "ok"
              ? <CircleCheck className="mt-px size-4 shrink-0" aria-hidden />
              : <CircleX className="mt-px size-4 shrink-0" aria-hidden />}
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="关闭提示"
              className="-m-1 shrink-0 rounded p-1 opacity-60 transition-opacity duration-fast hover:opacity-100">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
```

三处变化值得留意：容器 `pointer-events-none` 而每条 toast `pointer-events-auto`，这样右下角空白区不挡住页面点击；`aria-live="polite"` 让读屏软件播报；配色从实心 `bg-emerald-600` 改为浅底 + 语义色描边，与整体克制风格一致。

- [ ] **Step 4: 换 `RequireAuth.tsx` 的配色**

只改第 19-25 行的返回块，其余一行不动：

```tsx
  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-fg-muted">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        {checking ? "加载中…" : "正在跳转登录页…"}
      </div>
    );
  }
```

并在文件顶部加 `import { LoaderCircle } from "../ui/icons";`。第 4-5 行那段解释「校验期间不渲染后台 UI」的注释必须保留。

- [ ] **Step 5: 追加 `src/client/ui/index.ts` 导出**

```ts
export { Skeleton, SkeletonText, SkeletonCard } from "./Skeleton";
export { EmptyState } from "./EmptyState";
```

- [ ] **Step 6: 验证**

Run:
```bash
npm run typecheck && npm test && npm run build
```
Expected: 三条全部通过。

Run `npm run dev` 并登录，随便点一次「重新验证」或「立即触发」触发一条 toast：

- [ ] toast 从下方轻微弹入，不是硬切出现
- [ ] toast 右侧有关闭按钮，点击立即消失
- [ ] 不点也会在 3 秒后自动消失
- [ ] 深色模式下 toast 底色是深色调（不是刺眼的浅绿/浅红）

- [ ] **Step 7: 提交**

```bash
git add src/client/ui src/client/components/Toast.tsx src/client/components/RequireAuth.tsx
git commit -m "feat: 骨架屏与空态原语，Toast 加动画与手动关闭"
```

---

### Task 6: Layout、主题切换与 PageHeader

**Files:**
- Create: `src/client/components/ThemeToggle.tsx`, `src/client/components/PageHeader.tsx`
- Rewrite: `src/client/components/Layout.tsx`

**Interfaces:**
- Consumes: Task 1 的 `useTheme`；Task 3 的 `cx`、`icons`
- Produces:
  - `ThemeToggle`: 无 props
  - `PageHeader`: `{ title: string; description?: string; action?: ReactNode }`

- [ ] **Step 1: 写 `src/client/components/ThemeToggle.tsx`**

三段式分组按钮，比下拉菜单少一次点击，且当前状态一眼可见。

```tsx
import { useTheme, type ThemePref } from "../theme";
import { Monitor, Moon, Sun, type LucideIcon } from "../ui/icons";
import { cx } from "../ui/styles";

const OPTIONS: { value: ThemePref; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
  { value: "system", label: "跟随系统", Icon: Monitor },
];

export default function ThemeToggle() {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="主题"
      className="flex gap-0.5 rounded-lg border border-border bg-surface p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={label}
          title={label}
          onClick={() => setPref(value)}
          className={cx(
            "flex flex-1 items-center justify-center rounded-md py-1.5",
            "transition-colors duration-fast ease-smooth",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
            pref === value ? "bg-panel text-fg shadow-sm" : "text-fg-subtle hover:text-fg",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 写 `src/client/components/PageHeader.tsx`**

```tsx
import type { ReactNode } from "react";

type Props = { title: string; description?: string; action?: ReactNode };

export default function PageHeader({ title, description, action }: Props) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 3: 重写 `src/client/components/Layout.tsx` —— 顶部与导航项**

先写文件的上半部分（imports、导航表、`NavItems` 子组件）。

```tsx
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { get, post } from "../api";
import type { Stats } from "../types";
import {
  LayoutDashboard, LogOut, Menu as MenuIcon, ScrollText, Timer, Users, X,
  type LucideIcon,
} from "../ui/icons";
import { cx } from "../ui/styles";
import ThemeToggle from "./ThemeToggle";

type Link = {
  to: string; label: string; end: boolean; Icon: LucideIcon;
  count?: "accounts" | "total_jobs";
};

const LINKS: Link[] = [
  { to: "/", label: "仪表盘", end: true, Icon: LayoutDashboard },
  { to: "/accounts", label: "账号", end: false, Icon: Users, count: "accounts" },
  { to: "/jobs", label: "任务", end: false, Icon: Timer, count: "total_jobs" },
  { to: "/runs", label: "运行记录", end: false, Icon: ScrollText },
];

function NavItems({ stats, onNavigate }: { stats: Stats | null; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {LINKS.map(({ to, label, end, Icon, count }) => (
        <NavLink key={to} to={to} end={end} onClick={onNavigate}
          className={({ isActive }) => cx(
            "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm",
            "transition-colors duration-fast ease-smooth",
            "before:absolute before:top-1/2 before:left-0 before:h-4 before:w-0.5",
            "before:-translate-y-1/2 before:rounded-full before:bg-accent",
            "before:transition-opacity before:duration-fast",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
            isActive
              ? "bg-panel-hover font-medium text-fg before:opacity-100"
              : "text-fg-muted before:opacity-0 hover:bg-panel-hover hover:text-fg",
          )}>
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate">{label}</span>
          {count && stats && (
            <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{stats[count]}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
```

计数刻意用极简数字而非 `Badge`：`Badge` 的 `neutral` 底色是 `bg-panel-hover`，而激活行的底色也是 `panel-hover`，两者叠在一起徽章会糊掉。

激活指示条用 `before:` 伪元素而非真实 DOM 节点，避免每个导航项多一个 `<span>`。

- [ ] **Step 4: 续写 `Layout.tsx` —— 状态与共享片段**

接在 Step 3 的代码后面，同一个文件。

```tsx
export default function Layout() {
  const nav = useNavigate();
  const loc = useLocation();
  const [stats, setStats] = useState<Stats | null>(null);
  const [open, setOpen] = useState(false);

  // 路由变化就重新拉计数：新建或删除任务/账号后，徽章不会停在旧值。
  useEffect(() => { get<Stats>("/api/stats").then(setStats).catch(() => {}); }, [loc.pathname]);

  // 抽屉打开期间锁背景滚动，并支持 Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    await post("/api/auth/logout");
    nav("/login");
  }

  const brand = (
    <div className="flex items-center gap-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-fg text-[11px] font-bold text-surface">
        AC
      </span>
      <span className="truncate text-sm font-semibold tracking-tight text-fg">Actions Cronhub</span>
    </div>
  );

  const footer = (
    <div className="mt-auto flex flex-col gap-2 pt-4">
      <ThemeToggle />
      <button type="button" onClick={logout}
        className={cx(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg-muted",
          "transition-colors duration-fast ease-smooth hover:bg-danger-soft hover:text-danger",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        )}>
        <LogOut className="size-4 shrink-0" aria-hidden />
        退出登录
      </button>
    </div>
  );
```

`brand` 与 `footer` 抽成变量：桌面侧栏和窄屏抽屉共用同一份，不复制两遍。

- [ ] **Step 5: 续写 `Layout.tsx` —— 布局骨架**

接在 Step 4 的代码后面，闭合 `Layout` 函数。

```tsx
  return (
    <div className="min-h-screen bg-surface text-fg">
      {/* 桌面固定侧栏（≥ lg） */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-border bg-panel p-4 lg:flex">
        {brand}
        <div className="mt-6"><NavItems stats={stats} /></div>
        {footer}
      </aside>

      {/* 窄屏抽屉导航（< lg） */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div onClick={() => setOpen(false)}
            className="animate-fade-in absolute inset-0 bg-black/50" />
          <aside className="animate-in-left absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-panel p-4">
            <div className="flex items-center justify-between gap-2">
              {brand}
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭导航"
                className="rounded-md p-1 text-fg-muted transition-colors duration-fast hover:bg-panel-hover hover:text-fg">
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="mt-6"><NavItems stats={stats} onNavigate={() => setOpen(false)} /></div>
            {footer}
          </aside>
        </div>
      )}

      <div className="lg:pl-56">
        {/* 窄屏顶部条 */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-panel/85 px-4 py-3 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="打开导航" aria-expanded={open}
            className="rounded-md p-1 text-fg-muted transition-colors duration-fast hover:bg-panel-hover hover:text-fg">
            <MenuIcon className="size-5" aria-hidden />
          </button>
          {brand}
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

要点：

- 内容区的左侧留白靠外层 `div` 的 `lg:pl-56`，不要写在 `<main>` 上——`<main>` 同时带 `mx-auto`，`ml-*` 会把居中覆盖掉。
- 原文件 `<main>` 上的 `overflow-x-auto` 删掉。它是为 9 列宽表格准备的横向滚动，Task 7 把任务表换成列表行卡片后不再需要；留着会在窄屏产生意外的横向滚动条。
- 抽屉用普通 `div` + 手写遮罩，不用 `ui/Drawer`：`Drawer` 固定从右侧滑入且带脏态确认，导航抽屉需要的是左侧滑入且无脏态概念。这两个组件的需求不重叠，硬套会给 `Drawer` 加两个只有一处用到的参数。
- 抽屉里的导航项点击后调用 `onNavigate` 自动关闭。

- [ ] **Step 6: 验证**

```bash
npm run typecheck && npm test && npm run build
```

预期：typecheck 无错误，测试全绿（Task 1-2 的 3 个前端测试文件 + 服务端 10 个测试文件），build 成功。

`npm run dev` 后人工核对（此时页面内容仍是旧样式，Task 7-11 才逐页重写，外框与内容风格不统一是**预期现象**）：

| 检查项 | 判定标准 |
|---|---|
| 桌面侧栏 | 宽度 224px，内容区在超宽屏上居中且不超过 `max-w-6xl` |
| 导航激活态 | 当前页左侧有 2px indigo 竖条 + 淡底，其余项无竖条 |
| 计数 | 「账号」「任务」右侧显示数字，与 `/api/stats` 返回一致；新建任务后返回列表页数字 +1 |
| 窄屏（浏览器缩到 < 1024px） | 侧栏消失，出现顶部条；点汉堡从左侧滑出抽屉；点导航项后抽屉自动关闭；Esc 与点遮罩都能关闭；抽屉打开时背景不滚动 |
| 主题切换 | 三个按钮切换后立即生效；刷新后保持；选「跟随系统」时改系统深浅色能实时跟随 |
| 键盘 | Tab 能走到每个导航项与主题按钮，焦点环可见 |

- [ ] **Step 7: Commit**

```bash
git add src/client/components/Layout.tsx src/client/components/ThemeToggle.tsx src/client/components/PageHeader.tsx
git commit -m "feat: 侧栏重写、响应式抽屉导航与主题切换入口"
```

---

### Task 7: 任务页重写（拆分 + 列表行卡片 + 乐观启停）

**Files:**
- Delete: `src/client/pages/Jobs.tsx`
- Create: `src/client/pages/Jobs/index.tsx`, `JobRow.tsx`, `JobForm.tsx`, `ScheduleEditor.tsx`
- 已存在（Task 2 建的）: `src/client/pages/Jobs/schedule.ts`
- 不动: `src/client/App.tsx`(`import Jobs from "./pages/Jobs"` 会自动解析到 `Jobs/index.tsx`)

**Interfaces:**
- Consumes: Task 2 的 `parseSchedule` / `describeLocal` / `EMPTY_SCHEDULE`、`fmtTime` / `fmtShort` / `relativeTime`、`validateRepo` / `validateInputsJson`；Task 3-5 的 `Button` `Input` `Select` `Textarea` `Field` `Card` `Badge` `Switch` `Drawer` `Menu` `Skeleton` `EmptyState` `useConfirm` `useToast`；Task 6 的 `PageHeader`
- Produces:
  - `JobRow.tsx`: `default JobRow`，props `{ job, lastRun?, triggering, onToggle, onTrigger, onEdit, onRemove }`
  - `JobForm.tsx`: `default JobForm`，props `{ open, form, accounts, busy, dirty, onChange, onClose, onSubmit }`；另导出 `type JobFormData`、`EMPTY_FORM`
  - `ScheduleEditor.tsx`: `default ScheduleEditor`，props `{ value, onChange, onError }`

**先读三条服务端事实**（读代码得来，决定了本任务的写法，别凭直觉改）：

1. `POST /api/jobs/:id/toggle` 返回 `{ enabled, next_run_at }`（[`jobs.ts:124`](../../../src/server/routes/jobs.ts#L124)）。乐观翻转成功后用这两个权威值覆盖本地，不必整表重拉。
2. **手动触发不会更新 `jobs.last_run_at`** —— 只有定时分支写这个字段（[`scheduler.ts:89`](../../../src/server/scheduler.ts#L89)）。所以卡片第四行「上次运行」必须以 `runs` 为准，不能读 `job.last_run_at`。
3. 手动触发无论成败都会写一条 `runs` 记录（[`scheduler.ts:35`](../../../src/server/scheduler.ts#L35)、[`scheduler.ts:49`](../../../src/server/scheduler.ts#L49)），`/api/runs` 按 `triggered_at DESC` 排序（[`runs.ts:23`](../../../src/server/routes/runs.ts#L23)）。所以触发后重拉一次 `/api/runs?page=1` 就能拿到含 HTTP 码与错误文案的真实结果，**不需要**在前端另存一份「本次触发结果」的影子状态。

`Job` 类型里没有 `last_run_status`，而 API 形状不许改。因此第四行的状态来自「最近 50 条运行记录」按 `job_id` 建的索引；更久没跑过的任务索引里查不到，退化为只显示时间、图标用中性色。这是刻意的取舍，不要为它加接口。

- [ ] **Step 1: 删除旧文件**

```bash
git rm src/client/pages/Jobs.tsx
```

此时 `npm run typecheck` 会报错（`App.tsx` 找不到模块），Step 4 建出 `Jobs/index.tsx` 后恢复。中途不要 commit。

- [ ] **Step 2: 写 `src/client/pages/Jobs/ScheduleEditor.tsx` —— 上半部分**

由原 `Jobs.tsx:36-109` 迁出后改造。保留 400ms 防抖与 `/api/cron/preview` 调用，改动三处：分段控件换成新样式、错误改为通过 `onError` 上报给表单、预览时间补相对时间。

```tsx
import { useEffect, useState } from "react";
import { get } from "../../api";
import type { Schedule } from "../../types";
import { Input, Select, cx } from "../../ui";
import { fmtTime, relativeTime } from "../../utils/time";
import { EMPTY_SCHEDULE } from "./schedule";

type Props = {
  value: Schedule;
  onChange: (s: Schedule) => void;
  /** 把 /api/cron/preview 的报错上报给表单，用于禁用保存按钮 */
  onError: (msg: string | null) => void;
};

const TABS: { type: Schedule["type"]; label: string }[] = [
  { type: "interval", label: "间隔" },
  { type: "cron", label: "cron 表达式" },
];

export default function ScheduleEditor({ value, onChange, onError }: Props) {
  const [preview, setPreview] = useState<{ ms: number; text: string }[]>([]);
  const [err, setErr] = useState("");

  const key = JSON.stringify(value);
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const data = await get<{ times: number[] }>(
          `/api/cron/preview?rule=${encodeURIComponent(key)}`,
        );
        setPreview(data.times.map(ms => ({ ms, text: fmtTime(ms) })));
        setErr("");
        onError(null);
      } catch (e) {
        setPreview([]);
        setErr((e as Error).message);
        onError((e as Error).message);
      }
    }, 400); // 防抖
    return () => clearTimeout(t);
  }, [key]);
```

`useEffect` 的依赖只写 `[key]`，**不要**把 `onError` 加进去。`onError` 是父组件每次渲染新建的内联函数，加进依赖会让防抖计时器被反复重建，等效于取消防抖。

- [ ] **Step 3: 续写 `ScheduleEditor.tsx` —— 渲染部分**

```tsx
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-3">
        <Segmented
          label="调度类型"
          value={value.type}
          options={TABS.map(t => ({ value: t.type, label: t.label }))}
          onChange={type => onChange(
            type === "cron" ? { type: "cron", expr: "30 3 * * *" } : EMPTY_SCHEDULE,
          )}
        />
      </div>

      {value.type === "cron" ? (
        <Input value={value.expr ?? ""} invalid={!!err}
          placeholder="分 时 日 月 周（UTC），如 30 3 * * *"
          onChange={e => onChange({ ...value, expr: e.target.value })} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-32">
            <Select value={value.mode ?? "fixed"}
              onChange={e => onChange({
                ...value,
                mode: e.target.value as "fixed" | "random",
                ...(e.target.value === "random" ? { min: 30, max: 90 } : { value: 45 }),
              })}>
              <option value="fixed">固定间隔</option>
              <option value="random">随机间隔</option>
            </Select>
          </div>
          {value.mode === "random" ? (
            <>
              <div className="w-24">
                <Input type="number" min={1} value={value.min ?? 30}
                  onChange={e => onChange({ ...value, min: Number(e.target.value) })} />
              </div>
              <span className="text-fg-muted">~</span>
              <div className="w-24">
                <Input type="number" min={1} value={value.max ?? 90}
                  onChange={e => onChange({ ...value, max: Number(e.target.value) })} />
              </div>
            </>
          ) : (
            <div className="w-24">
              <Input type="number" min={1} value={value.value ?? 45}
                onChange={e => onChange({ ...value, value: Number(e.target.value) })} />
            </div>
          )}
          <div className="w-24">
            <Select value={value.unit ?? "m"}
              onChange={e => onChange({ ...value, unit: e.target.value as "m" | "h" | "d" })}>
              <option value="m">分钟</option>
              <option value="h">小时</option>
              <option value="d">天</option>
            </Select>
          </div>
        </div>
      )}
```

窄控件一律用外层 `<div className="w-24">` 限宽，控件自身保留 `controlBase` 的 `w-full`。**不要**改成给控件传 `className="w-24"`：`cx` 只是字符串拼接，`w-24` 与 `w-full` 在 Tailwind 里优先级相同，谁生效取决于生成的样式表顺序，不可控。

- [ ] **Step 4: 收尾 `ScheduleEditor.tsx` —— 预览与报错**

```tsx
      <div className="mt-3 text-xs">
        {err ? (
          <p role="alert" className="text-danger">{err}</p>
        ) : (
          <div className="text-fg-muted">
            <p className="mb-1">未来触发时间</p>
            <ul className="space-y-0.5">
              {preview.map(p => (
                <li key={p.ms} className="flex gap-2 font-mono tabular-nums">
                  <span className="text-fg">{p.text}</span>
                  <span className="text-fg-subtle">{relativeTime(p.ms)}</span>
                </li>
              ))}
            </ul>
            {value.type === "cron" && (
              <p className="mt-2">支持 <code>*</code>、<code>*/n</code>、<code>a-b</code>、逗号列表。按 UTC 计算。</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

调度报错用 `role="alert"`，改错时读屏软件能立刻播报。

- [ ] **Step 5: 写 `src/client/pages/Jobs/JobRow.tsx` —— 头部与状态行推导**

```tsx
import { Badge, Button, Card, Menu, Switch, type MenuItem } from "../../ui";
import {
  ArrowRight, CircleAlert, CircleCheck, CircleX, GitBranch, Pencil, Play, Timer, Trash2,
} from "../../ui/icons";
import type { Job, Run } from "../../types";
import { fmtShort, relativeTime } from "../../utils/time";
import { describeLocal, parseSchedule } from "./schedule";

type Props = {
  job: Job;
  /** 最近 50 条运行记录里属于该任务的最新一条；查不到为 undefined */
  lastRun?: Run;
  triggering: boolean;
  onToggle: () => void;
  onTrigger: () => void;
  onEdit: () => void;
  onRemove: () => void;
};

type Line = { tone: "success" | "danger" | "muted"; text: string };

function lastLine(job: Job, lastRun?: Run): Line | null {
  if (lastRun) {
    const when = `${fmtShort(lastRun.triggered_at)}（${relativeTime(lastRun.triggered_at)}）`;
    const how = lastRun.source === "manual" ? "手动" : "定时";
    if (lastRun.status === "failed") {
      return { tone: "danger", text: `上次 ${when} ${how}失败 · HTTP ${lastRun.http_status ?? "-"}` };
    }
    return { tone: "success", text: `上次 ${when} ${how}成功` };
  }
  // 更早于最近 50 条记录：只有 jobs.last_run_at，拿不到成败
  if (job.last_run_at) return { tone: "muted", text: `上次 ${fmtShort(job.last_run_at)}（${relativeTime(job.last_run_at)}）` };
  return null;
}

const LINE_ICON = { success: CircleCheck, danger: CircleX, muted: CircleAlert } as const;
const LINE_CLS = { success: "text-success", danger: "text-danger", muted: "text-fg-subtle" } as const;
```

- [ ] **Step 6: 续写 `JobRow.tsx` —— 卡片渲染**

四行信息层级，窄屏由 `flex-wrap` 自然堆叠，不写第二套布局。

```tsx
export default function JobRow({ job, lastRun, triggering, onToggle, onTrigger, onEdit, onRemove }: Props) {
  const target = job.trigger_type === "workflow_dispatch"
    ? `${job.workflow_id} @ ${job.ref}`
    : `event: ${job.event_type}`;
  const schedule = describeLocal(parseSchedule(job.schedule_json));
  const line = lastLine(job, lastRun);
  const LineIcon = line && LINE_ICON[line.tone];

  const items: MenuItem[] = [
    { label: "编辑", icon: <Pencil className="size-3.5" />, onSelect: onEdit },
    { label: "删除", icon: <Trash2 className="size-3.5" />, onSelect: onRemove, tone: "danger" },
  ];

  return (
    <Card interactive className="p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{job.name}</span>
        <Badge tone={job.enabled ? "success" : "neutral"}>{job.enabled ? "启用" : "停用"}</Badge>
        <Switch checked={job.enabled === 1} onChange={() => onToggle()} label={`启用「${job.name}」`} />
        <Button size="sm" variant="ghost" loading={triggering} onClick={onTrigger}
          icon={<Play className="size-3.5" />}>立即触发</Button>
        <Menu label={`「${job.name}」更多操作`} items={items} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5 font-mono">
          <GitBranch className="size-3.5 shrink-0" aria-hidden />{job.repo}
        </span>
        <span className="font-mono">{target}</span>
        <span>{job.account_name ?? "账号已删除"}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <Timer className="size-3.5 shrink-0" aria-hidden />{schedule}
        </span>
        {job.enabled === 1 && (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <ArrowRight className="size-3.5 shrink-0" aria-hidden />
            下次 {fmtShort(job.next_run_at)}
            <span className="text-fg-subtle">{relativeTime(job.next_run_at)}</span>
          </span>
        )}
      </div>

      {line && LineIcon && (
        <div className={`mt-1.5 inline-flex items-center gap-1.5 text-xs ${LINE_CLS[line.tone]}`}>
          <LineIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="tabular-nums">{line.text}</span>
        </div>
      )}
    </Card>
  );
}
```

停用的任务不显示「下次」——`next_run_at` 在停用期间是个不会发生的时间，显示它是误导。

- [ ] **Step 7: 写 `src/client/pages/Jobs/JobForm.tsx` —— 类型与校验**

```tsx
import { useState, type ReactNode } from "react";
import type { Account, Schedule } from "../../types";
import { Button, Drawer, Field, Input, Segmented, Select, Textarea } from "../../ui";
import { validateInputsJson, validateRepo } from "../../utils/validate";
import { EMPTY_SCHEDULE } from "./schedule";
import ScheduleEditor from "./ScheduleEditor";

export type JobFormData = {
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

export const EMPTY_FORM: JobFormData = {
  name: "", account_id: 0, repo: "", trigger_type: "workflow_dispatch",
  workflow_id: "", event_type: "", ref: "main", inputs_json: "",
  schedule: EMPTY_SCHEDULE,
};

type Key = "name" | "account_id" | "repo" | "workflow_id" | "event_type" | "inputs_json";

const ALL_TOUCHED: Record<Key, boolean> = {
  name: true, account_id: true, repo: true,
  workflow_id: true, event_type: true, inputs_json: true,
};

/** 全部校验规则集中在这里。合法为 null，否则为中文文案。 */
function validate(f: JobFormData): Record<Key, string | null> {
  return {
    name: f.name.trim() ? null : "任务名不能为空",
    account_id: f.account_id > 0 ? null : "请选择账号",
    repo: validateRepo(f.repo),
    workflow_id: f.trigger_type === "workflow_dispatch" && !f.workflow_id.trim()
      ? "请填写 workflow 文件名（如 run.yml）或 ID" : null,
    event_type: f.trigger_type === "repository_dispatch" && !f.event_type.trim()
      ? "请填写 repository_dispatch 事件类型" : null,
    inputs_json: validateInputsJson(f.inputs_json),
  };
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-fg-subtle uppercase">{title}</h3>
      {children}
    </section>
  );
}
```

前端这套规则与服务端 [`jobs.ts:22-62`](../../../src/server/routes/jobs.ts#L22) 的 `validateJobBody` 是**故意重复**的：前端管即时反馈，后端管安全边界，谁都不能省。文案刻意与后端保持一致，避免同一个错误在两处说法不同。

- [ ] **Step 8: 续写 `JobForm.tsx` —— 组件状态**

```tsx
type Props = {
  open: boolean;
  form: JobFormData;
  accounts: Account[];
  busy: boolean;
  /** 由父组件对比快照算出，交给 Drawer 决定是否二次确认 */
  dirty: boolean;
  onChange: (next: JobFormData) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export default function JobForm({
  open, form, accounts, busy, dirty, onChange, onClose, onSubmit,
}: Props) {
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [schedErr, setSchedErr] = useState<string | null>(null);

  const errors = validate(form);
  const blocked = Object.values(errors).some(Boolean) || !!schedErr;
  const set = (patch: Partial<JobFormData>) => onChange({ ...form, ...patch });
  const touch = (k: Key) => () => setTouched(t => ({ ...t, [k]: true }));
  const err = (k: Key) => (touched[k] ? errors[k] : null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // 点保存时把所有字段标记为已触碰，漏填的字段一次性全部亮红，而不是逐个试。
    setTouched(ALL_TOUCHED);
    if (blocked) return;
    onSubmit();
  }
```

校验只在失焦后显示（`touched`），避免新建表单一打开就满屏红字。

保存按钮**只在** `busy` 或未选账号时禁用（规格明确要求的那一条）。其余错误不禁用按钮，而是点击后一次性显示——按钮长期灰着而不说明原因是更糟的体验。

- [ ] **Step 9: 续写 `JobForm.tsx` —— 渲染「基本信息」组**

```tsx
  return (
    <Drawer open={open} onClose={onClose} dirty={dirty}
      title={form.id ? "编辑任务" : "新建任务"}>
      <form onSubmit={submit} noValidate>
        <Group title="基本信息">
          <Field label="任务名" error={err("name")}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} invalid={!!err("name")}
                value={form.name} onBlur={touch("name")}
                onChange={e => set({ name: e.target.value })} />
            )}
          </Field>
          <Field label="GitHub 账号" error={err("account_id")}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} invalid={!!err("account_id")}
                value={form.account_id} onBlur={touch("account_id")}
                onChange={e => set({ account_id: Number(e.target.value) })}>
                <option value={0}>请选择…</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.github_login ? `（@${a.github_login}）` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="仓库" hint="格式 owner/repo，如 alice/repo1" error={err("repo")}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} invalid={!!err("repo")}
                value={form.repo} placeholder="alice/repo1" onBlur={touch("repo")}
                onChange={e => set({ repo: e.target.value })} />
            )}
          </Field>
        </Group>
```

- [ ] **Step 10: 收尾 `JobForm.tsx` —— 触发方式与调度**

```tsx
        <Group title="触发方式">
          <div className="mb-4">
            <Segmented
              label="触发方式"
              value={form.trigger_type}
              options={[
                { value: "workflow_dispatch", label: "workflow_dispatch" },
                { value: "repository_dispatch", label: "repository_dispatch" },
              ]}
              onChange={trigger_type => set({ trigger_type })}
            />
          </div>

          {form.trigger_type === "workflow_dispatch" ? (
            <>
              <Field label="Workflow 文件名 / ID" error={err("workflow_id")}>
                {({ id, describedBy }) => (
                  <Input id={id} aria-describedby={describedBy} invalid={!!err("workflow_id")}
                    value={form.workflow_id} placeholder="run.yml" onBlur={touch("workflow_id")}
                    onChange={e => set({ workflow_id: e.target.value })} />
                )}
              </Field>
              <Field label="分支 / Ref">
                {({ id }) => (
                  <Input id={id} value={form.ref}
                    onChange={e => set({ ref: e.target.value })} />
                )}
              </Field>
            </>
          ) : (
            <Field label="事件类型（event_type）" error={err("event_type")}>
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} invalid={!!err("event_type")}
                  value={form.event_type} placeholder="cron" onBlur={touch("event_type")}
                  onChange={e => set({ event_type: e.target.value })} />
              )}
            </Field>
          )}

          <Field label="inputs / payload" hint="JSON 对象，可留空" error={err("inputs_json")}>
            {({ id, describedBy }) => (
              <Textarea id={id} aria-describedby={describedBy} invalid={!!err("inputs_json")}
                rows={3} className="font-mono text-xs" value={form.inputs_json}
                placeholder='{"key":"value"}' onBlur={touch("inputs_json")}
                onChange={e => set({ inputs_json: e.target.value })} />
            )}
          </Field>
        </Group>

        <Group title="调度规则">
          <ScheduleEditor value={form.schedule} onError={setSchedErr}
            onChange={schedule => set({ schedule })} />
        </Group>

        <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-border bg-panel px-5 py-3">
          <Button type="submit" loading={busy} disabled={form.account_id === 0}>保存</Button>
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
        </div>
      </form>
    </Drawer>
  );
}
```

底部操作条 `sticky bottom-0` + `-mx-5` 出血到抽屉边缘：表单长到需要滚动时，保存按钮始终可见。`-mx-5` 对应 `Drawer` 内容区的 `px-5`。

- [ ] **Step 11: 写 `src/client/pages/Jobs/index.tsx` —— 数据与编排**

```tsx
import { useEffect, useState } from "react";
import { del, get, post, put } from "../../api";
import PageHeader from "../../components/PageHeader";
import { useToast } from "../../components/Toast";
import type { Account, Job, Run } from "../../types";
import { Button, EmptyState, SkeletonCard, useConfirm } from "../../ui";
import { Inbox, Plus } from "../../ui/icons";
import JobForm, { EMPTY_FORM, type JobFormData } from "./JobForm";
import JobRow from "./JobRow";
import { parseSchedule } from "./schedule";

export default function Jobs() {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Job[] | null>(null); // null = 首屏加载中
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lastRuns, setLastRuns] = useState<Record<number, Run>>({});
  const [form, setForm] = useState<JobFormData | null>(null);
  const [snapshot, setSnapshot] = useState<JobFormData | null>(null);
  const [busy, setBusy] = useState(false);
  const [triggering, setTriggering] = useState<number | null>(null);

  async function load() {
    const [jobs, runs] = await Promise.all([
      get<Job[]>("/api/jobs"),
      get<{ rows: Run[] }>("/api/runs?page=1"),
    ]);
    // runs 按 triggered_at DESC，首次出现即该任务的最新一条
    const latest: Record<number, Run> = {};
    for (const r of runs.rows) if (!latest[r.job_id]) latest[r.job_id] = r;
    setList(jobs);
    setLastRuns(latest);
  }

  useEffect(() => {
    load().catch(e => toast((e as Error).message, "err"));
    get<Account[]>("/api/accounts").then(setAccounts).catch(() => {});
  }, []);

  function open(data: JobFormData) {
    setForm(data);
    setSnapshot(data); // 脏态判定的基准
  }

  function edit(j: Job) {
    open({
      id: j.id, name: j.name, account_id: j.account_id, repo: j.repo,
      trigger_type: j.trigger_type, workflow_id: j.workflow_id ?? "",
      event_type: j.event_type ?? "", ref: j.ref ?? "main",
      inputs_json: j.inputs_json ?? "", schedule: parseSchedule(j.schedule_json),
    });
  }
```

`list` 用 `Job[] | null` 而不是 `Job[]`：只有区分「还没加载完」和「加载完但是空的」，才能一个显骨架、一个显空态。原实现两种情况都渲染「还没有任务」，首屏会闪一下假空态。

- [ ] **Step 12: 续写 `index.tsx` —— 提交、乐观启停、触发、删除**

```tsx
  async function submit() {
    if (!form) return;
    setBusy(true);
    // 表单不含 enabled，而后端缺省会置为 1；编辑时必须回传原有启用状态，
    // 否则停用的任务会被静默重新启用。
    const editing = form.id ? list?.find(j => j.id === form.id) : undefined;
    const body = { ...form, enabled: editing ? editing.enabled : 1 };
    try {
      if (form.id) await put(`/api/jobs/${form.id}`, body);
      else await post("/api/jobs", body);
      toast(form.id ? "任务已更新" : "任务已创建");
      setForm(null);
      setSnapshot(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  /** 乐观启停：先翻本地，成功后用服务端返回的权威值覆盖，失败回滚。 */
  async function toggle(j: Job) {
    const patch = (fn: (x: Job) => Job) =>
      setList(l => l && l.map(x => (x.id === j.id ? fn(x) : x)));
    patch(x => ({ ...x, enabled: x.enabled === 1 ? 0 : 1 }));
    try {
      const d = await post<{ enabled: number; next_run_at: number }>(`/api/jobs/${j.id}/toggle`);
      patch(x => ({ ...x, enabled: d.enabled, next_run_at: d.next_run_at }));
    } catch (e) {
      patch(x => ({ ...x, enabled: j.enabled })); // 回滚到点击前的值
      toast((e as Error).message, "err");
    }
  }

  async function triggerNow(j: Job) {
    setTriggering(j.id);
    try {
      await post(`/api/jobs/${j.id}/trigger`);
      toast(`已触发：${j.name}`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setTriggering(null);
      // 成败都重拉：服务端两种情况都写了 runs 记录，
      // 卡片第四行会就地显示本次结果（含失败的 HTTP 码）。
      await load().catch(() => {});
    }
  }

  async function remove(j: Job) {
    const ok = await confirm({
      title: `删除任务「${j.name}」？`,
      description: "该任务的全部运行记录会一并删除，且无法恢复。",
      confirmText: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await del(`/api/jobs/${j.id}`);
      toast("已删除");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }
```

`enabled` 回传那段注释**必须原样保留**。它记录的是一个真实修过的 bug（编辑停用任务会把它静默启用），删掉注释下一个人就会再踩一次。

启停用 `patch` 闭包统一改这一行，避免三处各写一遍 `map`。回滚用的是**点击前**捕获的 `j.enabled`，不是再取反一次——如果期间还有别的更新，再取反会算错。

- [ ] **Step 13: 收尾 `index.tsx` —— 渲染**

```tsx
  const dirty = !!form && !!snapshot && JSON.stringify(form) !== JSON.stringify(snapshot);

  return (
    <div>
      <PageHeader
        title="定时任务"
        description="按间隔或 cron 触发 GitHub Actions。"
        action={
          <Button icon={<Plus className="size-4" />} onClick={() => open({ ...EMPTY_FORM })}>
            新建任务
          </Button>
        }
      />

      {list === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title="还没有任务"
          description="创建第一个任务，让 GitHub Actions 按时自己跑起来。"
          action={
            <Button icon={<Plus className="size-4" />} onClick={() => open({ ...EMPTY_FORM })}>
              新建任务
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {list.map(j => (
            <JobRow
              key={j.id}
              job={j}
              lastRun={lastRuns[j.id]}
              triggering={triggering === j.id}
              onToggle={() => void toggle(j)}
              onTrigger={() => void triggerNow(j)}
              onEdit={() => edit(j)}
              onRemove={() => void remove(j)}
            />
          ))}
        </div>
      )}

      {form && (
        <JobForm
          open
          form={form}
          accounts={accounts}
          busy={busy}
          dirty={dirty}
          onChange={setForm}
          onClose={() => { setForm(null); setSnapshot(null); }}
          onSubmit={() => void submit()}
        />
      )}
    </div>
  );
}
```

脏态用 `JSON.stringify` 对比快照。字段少、结构浅，比逐字段比较短得多，也不会漏掉新加的字段。

- [ ] **Step 14: 验证**

```bash
npm run typecheck && npm test && npm run build
```

预期：全部通过。若 typecheck 报 `Cannot find module "./pages/Jobs"`，说明 `Jobs/index.tsx` 的默认导出漏了。

`npm run dev` 后逐条核对：

| 检查项 | 判定标准 |
|---|---|
| 首屏 | 先看到 3 张骨架卡，再换成真实卡片；没有「还没有任务」闪现 |
| 卡片四行 | 名称/徽章/开关/触发/`⋯` 一行；仓库与触发目标一行；调度与下次一行；上次结果一行 |
| 停用任务 | 关掉开关后该卡片不再显示「下次」 |
| 乐观启停成功 | 点开关立刻翻转，无等待感；刷新页面状态一致 |
| 乐观启停失败回滚 | DevTools Network 切「Offline」→ 点开关 → 开关先翻转、随后弹回原位并出现红色 toast |
| 立即触发 | 按钮进 spinner 且不可重复点；结束后第四行变成本次结果；失败时显示 HTTP 码与红色图标 |
| 删除 | 弹自定义确认框（不是浏览器原生框），文案含「运行记录会一并删除」；取消后任务仍在 |
| 表单校验 | 仓库填 `abc` 失焦 → 字段下方红字「格式应为 owner/repo」；`inputs` 填 `[1,2]` → 提示必须是 JSON 对象 |
| 保存禁用 | 新建表单未选账号时「保存」灰掉；选了账号后可点，此时若任务名为空，点保存所有缺失字段一次性亮红 |
| cron 报错 | 调度切 cron 填 `abc` → 编辑器内出现红字错误，「保存」点了不提交 |
| 脏态确认 | 打开抽屉改一个字 → 按 Esc / 点遮罩 / 点关闭都弹「放弃未保存的改动？」；未改动时直接关闭 |
| **enabled 回归** | 把某任务停用 → 编辑它 → 只改任务名 → 保存 → **它必须仍是停用**（这条曾经是 bug，务必验） |
| 窄屏 | 缩到手机宽度，卡片内容自然换行堆叠，页面无横向滚动条 |

- [ ] **Step 15: Commit**

```bash
git add -A src/client/pages
git commit -m "feat: 任务页拆分重写，列表行卡片与乐观启停"
```

`git add -A` 用来同时记录 `pages/Jobs.tsx` 的删除与 `pages/Jobs/` 的新增。

---

### Task 8: 账号页重写

**Files:**
- Delete: `src/client/pages/Accounts.tsx`
- Create: `src/client/pages/Accounts/index.tsx`, `src/client/pages/Accounts/AccountCard.tsx`
- 不动: `src/client/App.tsx`(`import Accounts from "./pages/Accounts"` 自动解析到 `Accounts/index.tsx`)

**Interfaces:**
- Consumes: Task 3-5 的 `Button` `Input` `Field` `Card` `Badge` `Skeleton` `EmptyState` `useConfirm` `useToast`；Task 6 的 `PageHeader`；`fmtTime`
- Produces: `AccountCard.tsx` 默认导出 `AccountCard`，props `{ account, editing, verifying, onEdit, onCancelEdit, onSaved, onVerify, onRemove }`

**必须原样保留的两处既有行为：**

- **就地添加与就地编辑都不换成抽屉。** 就地编辑是 commit `6da023e` 刻意做的；添加只有 3 个字段，抽屉是过度设计。本任务只换样式与原语。
- **状态徽章不能被挤压变形。** 原实现靠 `shrink-0` 修复（commit `6da023e`），新的 `Badge` 原语已内置 `shrink-0` + `whitespace-nowrap`，直接用即可，不要在外面再套会压缩它的容器。

- [ ] **Step 1: 删除旧文件**

```bash
git rm src/client/pages/Accounts.tsx
```

- [ ] **Step 2: 写 `AccountCard.tsx` —— 状态徽章与查看态**

```tsx
import { useState } from "react";
import { put } from "../../api";
import { useToast } from "../../components/Toast";
import type { Account } from "../../types";
import { Badge, Button, Card, Field, Input } from "../../ui";
import {
  CircleAlert, CircleCheck, CircleX, KeyRound, Pencil, RefreshCw, Trash2,
} from "../../ui/icons";
import { fmtTime } from "../../utils/time";

const STATUS = {
  ok: { tone: "success", label: "有效", Icon: CircleCheck },
  invalid: { tone: "danger", label: "失效", Icon: CircleX },
  unknown: { tone: "neutral", label: "未验证", Icon: CircleAlert },
} as const;

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status as keyof typeof STATUS] ?? STATUS.unknown;
  return <Badge tone={s.tone} icon={<s.Icon className="size-3" aria-hidden />}>{s.label}</Badge>;
}
```

原实现的三套 `bg-emerald-100 text-emerald-700` 硬编码在深色底上刺眼，这里换成语义令牌（`Badge` 的 `success-soft` / `danger-soft`），深浅两套自动成立。

- [ ] **Step 3: 续写 `AccountCard.tsx` —— 查看态**

```tsx
type Props = {
  account: Account;
  editing: boolean;
  verifying: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  /** 保存成功后通知父组件重拉列表并退出编辑态 */
  onSaved: () => void;
  onVerify: () => void;
  onRemove: () => void;
};

export default function AccountCard(p: Props) {
  if (p.editing) return <EditForm account={p.account} onCancel={p.onCancelEdit} onSaved={p.onSaved} />;

  const { account: a } = p;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{a.name}</div>
          <div className="truncate text-sm text-fg-muted">
            {a.github_login ? `@${a.github_login}` : "未验证登录名"}
          </div>
        </div>
        <StatusBadge status={a.status} />
      </div>

      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-1.5 font-mono text-fg-muted">
          <KeyRound className="size-3.5 shrink-0" aria-hidden />
          {a.token_fingerprint}
        </div>
        <div className="text-fg-subtle">上次验证：{fmtTime(a.last_verified_at)}</div>
      </div>

      <div className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={p.verifying} onClick={p.onVerify}
          icon={<RefreshCw className="size-3.5" />}>重新验证</Button>
        <Button size="sm" variant="ghost" onClick={p.onEdit}
          icon={<Pencil className="size-3.5" />}>编辑</Button>
        <Button size="sm" variant="danger" onClick={p.onRemove}
          icon={<Trash2 className="size-3.5" />}>删除</Button>
      </div>
    </Card>
  );
}
```

`mt-auto` 把操作区推到卡片底部，同一行里高度不同的卡片按钮仍然对齐。

- [ ] **Step 4: 收尾 `AccountCard.tsx` —— 就地编辑态**

信息位置直接变输入框，保持原有交互（token 留空表示不修改）。

```tsx
function EditForm({ account, onCancel, onSaved }:
  { account: Account; onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(account.name);
  const [token, setToken] = useState("");
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // token 留空表示不修改，因此这里是条件展开而非总是传
      await put(`/api/accounts/${account.id}`, { name, ...(token ? { token } : {}), verify });
      toast("账号已更新");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-accent bg-panel p-4 ring-2 ring-accent/20">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Input value={name} aria-label="备注名" className="font-medium"
            onChange={e => setName(e.target.value)} />
        </div>
        <StatusBadge status={account.status} />
      </div>
      <div className="text-sm text-fg-muted">
        {account.github_login ? `@${account.github_login}` : "未验证登录名"}
      </div>
      <Field label="新 Token" hint="留空则不修改">
        {({ id, describedBy }) => (
          <Input id={id} aria-describedby={describedBy} type="password" value={token}
            placeholder="ghp_… / github_pat_…" onChange={e => setToken(e.target.value)} />
        )}
      </Field>
      <label className="flex items-center gap-2 text-xs text-fg-muted">
        <input type="checkbox" checked={verify} className="accent-accent"
          onChange={e => setVerify(e.target.checked)} />
        保存时在线验证 Token（推荐）
      </label>
      <div className="mt-auto flex gap-2">
        <Button type="submit" size="sm" loading={busy}>保存</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>取消</Button>
      </div>
    </form>
  );
}
```

编辑态用 `border-accent` + `ring-accent/20` 而非原来的 `border-indigo-300 dark:border-indigo-700`：一处令牌，两套配色都成立。

原生 `<input type="checkbox">` 不抽原语：全站只有就地添加与就地编辑这两处用到，各写一行 `accent-accent` 就能跟随主题色，抽一个 `Checkbox.tsx` 不划算。

- [ ] **Step 5: 写 `src/client/pages/Accounts/index.tsx` —— 数据与编排**

```tsx
import { useEffect, useState } from "react";
import { del, get, post } from "../../api";
import PageHeader from "../../components/PageHeader";
import { useToast } from "../../components/Toast";
import type { Account } from "../../types";
import { Button, EmptyState, Field, Input, SkeletonCard, useConfirm } from "../../ui";
import { KeyRound, Plus, X } from "../../ui/icons";
import AccountCard from "./AccountCard";

export default function Accounts() {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Account[] | null>(null); // null = 首屏加载中
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);

  async function load() {
    setList(await get<Account[]>("/api/accounts"));
  }
  useEffect(() => { load().catch(e => toast((e as Error).message, "err")); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/api/accounts", { name, token, verify });
      toast("账号已添加");
      setAdding(false); setName(""); setToken("");
      await load();
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function reVerify(a: Account) {
    setVerifyingId(a.id);
    try {
      await post(`/api/accounts/${a.id}/verify`);
      toast(`验证通过：${a.name}`);
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setVerifyingId(null);
      // 成败都重拉：验证失败时服务端会把 status 置为 invalid，卡片徽章要跟着变。
      await load().catch(() => {});
    }
  }

  async function remove(a: Account) {
    const ok = await confirm({
      title: `删除账号「${a.name}」？`,
      description: "该账号下的所有任务与运行记录会一并删除，且无法恢复。",
      confirmText: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await del(`/api/accounts/${a.id}`);
      toast("已删除");
      await load();
    } catch (err) {
      toast((err as Error).message, "err");
    }
  }
```

原实现的 `reVerify` 在 `try` 和 `catch` 里各写一次 `await load()`，这里合并到 `finally`，语义不变但少一处重复。

- [ ] **Step 6: 收尾 `Accounts/index.tsx` —— 渲染**

```tsx
  return (
    <div>
      <PageHeader
        title="GitHub 账号"
        description="Token 加密存储，仅用于触发 Actions。"
        action={
          <Button variant={adding ? "secondary" : "primary"} onClick={() => setAdding(v => !v)}
            icon={adding ? <X className="size-4" /> : <Plus className="size-4" />}>
            {adding ? "取消" : "添加账号"}
          </Button>
        }
      />

      {adding && (
        <form onSubmit={add}
          className="animate-in-pop mb-6 max-w-xl rounded-xl border border-border bg-panel p-4">
          <Field label="备注名">
            {({ id }) => (
              <Input id={id} value={name} placeholder="如：主账号"
                onChange={e => setName(e.target.value)} />
            )}
          </Field>
          <Field label="Personal Access Token" hint="加密存储，保存后不再显示明文；建议用最小权限的 Fine-grained PAT">
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} type="password" value={token}
                placeholder="ghp_… / github_pat_…" onChange={e => setToken(e.target.value)} />
            )}
          </Field>
          <label className="mb-4 flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={verify} className="accent-accent"
              onChange={e => setVerify(e.target.checked)} />
            保存时在线验证 Token（推荐）
          </label>
          <Button type="submit" loading={busy} disabled={!name.trim() || !token.trim()}>保存</Button>
        </form>
      )}

      {list === null ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="size-6" />}
          title="还没有账号"
          description="添加一个 GitHub Token，任务才能触发 Actions。"
          action={<Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>添加账号</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map(a => (
            <AccountCard
              key={a.id}
              account={a}
              editing={editingId === a.id}
              verifying={verifyingId === a.id}
              onEdit={() => setEditingId(a.id)}
              onCancelEdit={() => setEditingId(null)}
              onSaved={async () => { setEditingId(null); await load(); }}
              onVerify={() => void reVerify(a)}
              onRemove={() => void remove(a)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

添加面板用 `animate-in-pop` 做展开过渡。刻意不做高度过渡：`height` 动画会触发重排，且需要测量真实高度，代价远大于收益。

- [ ] **Step 7: 验证**

```bash
npm run typecheck && npm test && npm run build
```

`npm run dev` 后核对：

| 检查项 | 判定标准 |
|---|---|
| 首屏 | 先 3 张骨架卡，再换真实卡片；不闪「还没有账号」 |
| 状态徽章 | 深色模式下徽章底色是深色系（不是原来的亮 `emerald-100`）；卡片宽度收窄时徽章不被压扁、文字不换行 |
| 重新验证 | 按钮进 spinner；用一个失效 token 验证 → 弹红 toast 且徽章变「失效」 |
| 就地编辑 | 点「编辑」当前卡片原地变输入框（不弹抽屉）；边框变强调色；取消后恢复原样 |
| Token 留空 | 编辑时只改备注名、Token 留空 → 保存后指纹不变 |
| 添加面板 | 点「添加账号」面板带过渡展开，按钮变「取消」；名称或 Token 为空时「保存」灰掉 |
| 删除 | 弹自定义确认框，文案含「该账号下的所有任务与运行记录会一并删除」 |
| 窄屏 | 单列卡片，操作按钮换行不溢出 |

- [ ] **Step 8: Commit**

```bash
git add -A src/client/pages
git commit -m "feat: 账号页重写，语义徽章与确认弹层"
```

---

### Task 9: 运行记录页重写（URL 筛选状态）

**Files:**
- Rewrite: `src/client/pages/Runs.tsx`

**Interfaces:**
- Consumes: Task 3-5 的 `Button` `Select` `Segmented` `Skeleton` `EmptyState` `useConfirm` `useToast`；Task 6 的 `PageHeader`；`fmtTime`
- Produces: 无（页面组件）。**但本任务必须先于 Task 10 完成**——仪表盘的「查看失败记录」链接依赖这里的 URL query 初始化。

本任务把筛选状态从 `useState` 换成 URL query（`useSearchParams`）。三个好处：仪表盘可以直达 `/runs?status=failed`、浏览器后退键能回到上一个筛选、筛选结果可以直接分享链接。

- [ ] **Step 1: 写 `Runs.tsx` —— 状态从 URL 读**

```tsx
import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { get, post } from "../api";
import PageHeader from "../components/PageHeader";
import { useToast } from "../components/Toast";
import type { Job, Run } from "../types";
import { Button, EmptyState, Segmented, Select, Skeleton, cx, useConfirm } from "../ui";
import { ChevronLeft, ChevronRight, Inbox, Trash2 } from "../ui/icons";
import { fmtTime } from "../utils/time";

const PAGE_SIZE = 50; // 与服务端 routes/runs.ts 的 PAGE_SIZE 一致

type StatusFilter = "" | "success" | "failed";

export default function Runs() {
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Run[] | null>(null); // null = 加载中
  const [expanded, setExpanded] = useState<number | null>(null);

  const raw = params.get("status");
  const status: StatusFilter = raw === "success" || raw === "failed" ? raw : "";
  const jobId = Number(params.get("job_id") ?? 0) || 0;
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  /** 改筛选条件时同时把 page 清掉，避免停在一个不存在的页码上。 */
  function patch(next: Partial<Record<"status" | "job_id" | "page", string>>) {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (!v) q.delete(k); else q.set(k, v);
    }
    setParams(q, { replace: true });
  }

  useEffect(() => { get<Job[]>("/api/jobs").then(setJobs).catch(() => {}); }, []);

  useEffect(() => {
    setRows(null);
    const q = new URLSearchParams({
      page: String(page),
      ...(jobId ? { job_id: String(jobId) } : {}),
      ...(status ? { status } : {}),
    });
    get<{ total: number; rows: Run[] }>(`/api/runs?${q}`)
      .then(d => { setTotal(d.total); setRows(d.rows); })
      .catch(e => { setRows([]); toast((e as Error).message, "err"); });
  }, [jobId, status, page]);
```

`status` 不直接用 `params.get("status")`：URL 是用户可编辑的，`?status=whatever` 必须退化成「全部」而不是原样发给后端。服务端也做了同样的白名单（[`runs.ts:11`](../../../src/server/routes/runs.ts#L11)），两端都挡一次。

- [ ] **Step 2: 续写 `Runs.tsx` —— 清理与筛选栏**

```tsx
  async function cleanup() {
    const ok = await confirm({
      title: "清理 90 天前的运行记录？",
      description: "被清理的记录无法恢复。任务本身和调度设置不受影响。",
      confirmText: "清理",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const d = await post<{ deleted: number }>("/api/runs/cleanup", {});
      toast(`已清理 ${d.deleted} 条`);
      patch({ page: "" });
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="运行记录"
        description={`共 ${total} 条，保留最近 90 天。`}
        action={
          <Button variant="secondary" onClick={() => void cleanup()}
            icon={<Trash2 className="size-4" />}>清理 90 天前记录</Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="按状态筛选"
          value={status}
          options={[
            { value: "", label: "全部" },
            { value: "success", label: "成功" },
            { value: "failed", label: "失败" },
          ]}
          onChange={v => patch({ status: v, page: "" })}
        />
        <div className="w-56">
          <Select aria-label="按任务筛选" value={jobId}
            onChange={e => patch({ job_id: e.target.value, page: "" })}>
            <option value={0}>全部任务</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </Select>
        </div>
      </div>
```

`patch({ page: "" })` 用空字符串删除 `page` 参数——回到第 1 页时 URL 里不留 `page=1` 这种冗余。

`Segmented` 的 `value` 允许空串（类型是 `StatusFilter`），空串代表「全部」，与后端的「无 status 参数」对应。

- [ ] **Step 3: 续写 `Runs.tsx` —— 表格**

```tsx
      <div aria-busy={rows === null} className="overflow-hidden rounded-xl border border-border bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-fg-muted">
              <th className="py-2.5 pr-3 pl-4 font-medium">时间</th>
              <th className="p-3 font-medium">任务</th>
              <th className="p-3 font-medium">来源</th>
              <th className="p-3 font-medium">状态</th>
              <th className="p-3 font-medium">HTTP</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && [0, 1, 2, 3, 4].map(i => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                <td className="py-3 pr-3 pl-4"><Skeleton className="h-4 w-36" /></td>
                <td className="p-3"><Skeleton className="h-4 w-40" /></td>
                <td className="p-3"><Skeleton className="h-4 w-8" /></td>
                <td className="p-3"><Skeleton className="h-4 w-8" /></td>
                <td className="p-3"><Skeleton className="h-4 w-8" /></td>
              </tr>
            ))}

            {rows?.map(r => {
              const failed = r.status === "failed";
              const canExpand = failed && !!r.error_message;
              const isOpen = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  <tr
                    role={canExpand ? "button" : undefined}
                    tabIndex={canExpand ? 0 : undefined}
                    aria-expanded={canExpand ? isOpen : undefined}
                    onClick={canExpand ? () => setExpanded(isOpen ? null : r.id) : undefined}
                    onKeyDown={canExpand
                      ? e => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpanded(isOpen ? null : r.id);
                          }
                        }
                      : undefined}
                    className={cx(
                      "border-b border-border/60 last:border-0",
                      "transition-colors duration-fast ease-smooth",
                      failed ? "bg-danger-soft" : "hover:bg-panel-hover",
                      canExpand && "cursor-pointer",
                    )}
                  >
                    <td className={cx(
                      "border-l-2 py-3 pr-3 pl-4 text-xs tabular-nums",
                      failed ? "border-l-danger" : "border-l-success",
                    )}>{fmtTime(r.triggered_at)}</td>
                    <td className="p-3">{r.job_name ?? `任务#${r.job_id}`}</td>
                    <td className="p-3 text-xs text-fg-muted">{r.source === "manual" ? "手动" : "定时"}</td>
                    <td className={cx("p-3 text-xs font-medium", failed ? "text-danger" : "text-success")}>
                      {failed ? "失败" : "成功"}
                    </td>
                    <td className="p-3 font-mono text-xs tabular-nums">{r.http_status || "-"}</td>
                  </tr>
                  {isOpen && r.error_message && (
                    <tr className="border-b border-border/60 last:border-0">
                      <td colSpan={5} className="border-l-2 border-l-danger bg-danger-soft px-4 py-3">
                        <p className="font-mono text-xs break-all text-danger">{r.error_message}</p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {rows?.length === 0 && (
          <EmptyState
            icon={<Inbox className="size-6" />}
            title="暂无记录"
            description={status || jobId ? "当前筛选条件下没有记录，换个条件试试。" : "任务跑起来之后这里会出现记录。"}
          />
        )}
      </div>
```

状态色带做在第一个 `<td>` 的 `border-l-2` 上，不做在 `<tr>` 上——`<tr>` 的边框在 `border-collapse: collapse`（Tailwind preflight 的默认）下渲染行为不一致。

只有「失败且有错误详情」的行才可点击展开，并补上 `role="button"` / `tabIndex` / `aria-expanded` 与 Enter/空格支持。原实现所有行都挂 `onClick` 但成功行点了没反应，且完全不能键盘操作。

- [ ] **Step 4: 收尾 `Runs.tsx` —— 分页**

```tsx
      <div className="mt-4 flex items-center justify-between gap-3 text-sm">
        <p className="text-fg-muted tabular-nums">
          {total === 0
            ? "第 0 条"
            : `第 ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} 条，共 ${total} 条`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1}
            onClick={() => patch({ page: String(page - 1) })}
            icon={<ChevronLeft className="size-4" />}>上一页</Button>
          <span className="tabular-nums text-fg-muted">{page} / {totalPages}</span>
          <Button variant="secondary" size="sm" disabled={page >= totalPages}
            onClick={() => patch({ page: String(page + 1) })}>
            下一页<ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

「下一页」的图标写在 children 里而不是走 `icon` prop——`icon` 固定渲染在文字左侧，而这里箭头要在右侧。`Button` 内部是 `inline-flex items-center gap-1.5`，直接塞第二个 children 即可。

- [ ] **Step 5: 验证**

```bash
npm run typecheck && npm run test && npm run build
```

预期：全绿。

`npm run dev` 后人工核验：

| 项 | 期望 |
|---|---|
| 直接访问 `/runs?status=failed` | 分段控件停在「失败」，列表只有失败记录 |
| 访问 `/runs?status=garbage` | 退化为「全部」，不报错，不把 `garbage` 发给后端 |
| 切换状态筛选后按浏览器后退 | 回到上一个筛选条件 |
| 翻到第 2 页再改任务筛选 | 自动回到第 1 页，URL 里没有 `page` 参数 |
| 加载中 | 5 行骨架，不是空白 |
| 筛选到无结果 | `EmptyState` 文案为「当前筛选条件下没有记录」 |
| 失败行 | 左侧红色色带 + `danger-soft` 底色 |
| 成功行 | 左侧绿色色带，悬停变 `panel-hover` |
| 点失败行 | 展开等宽错误详情；再点收起 |
| Tab 到失败行按 Enter/空格 | 同样能展开收起 |
| Tab 到成功行 | 跳过（成功行不可聚焦） |
| 清理按钮 | 弹自定义确认框，取消则什么都不做 |
| 深色模式 | 失败行底色是深红而非刺眼的浅红 |
| 窄屏 | 筛选栏换行，表格横向滚动（表格保留是既定决策） |

- [ ] **Step 6: Commit**

```bash
git add src/client/pages/Runs.tsx
git commit -m "refactor(client): 运行记录页改用 URL 筛选状态，补骨架与空态"
```

---

### Task 10: 仪表盘重写

**Files:**
- Rewrite: `src/client/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: Task 3-5 的 `Card` `SkeletonCard` `Skeleton` `EmptyState`；Task 6 的 `PageHeader`；`fmtTime` 与 `relativeTime`（Task 2 的 `utils/time.ts`）
- Produces: 无（页面组件）。依赖 Task 9 已完成——「查看失败记录」链接直达 `/runs?status=failed`。

- [ ] **Step 1: 写 `Dashboard.tsx` —— 数据与统计卡**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";
import PageHeader from "../components/PageHeader";
import type { Run, Stats } from "../types";
import { Card, EmptyState, Skeleton, SkeletonCard, cx } from "../ui";
import { ArrowRight, CircleAlert, CircleCheck, CircleX, Clock, Inbox, Play, Timer, Users } from "../ui/icons";
import { fmtShort, relativeTime } from "../utils/time";

type StatCard = {
  key: keyof Stats;
  label: string;
  icon: React.ReactNode;
  /** 值大于 0 时转为警示样式 */
  alarm?: boolean;
};

const CARDS: StatCard[] = [
  { key: "accounts", label: "账号", icon: <Users className="size-4" /> },
  { key: "total_jobs", label: "任务总数", icon: <Timer className="size-4" /> },
  { key: "enabled_jobs", label: "已启用", icon: <Play className="size-4" /> },
  { key: "today_runs", label: "今日运行", icon: <Clock className="size-4" /> },
  { key: "failed_24h", label: "近 24h 失败", icon: <CircleAlert className="size-4" />, alarm: true },
];

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);

  useEffect(() => {
    get<Stats>("/api/stats").then(setStats).catch(() => setStats(null));
    get<{ rows: Run[] }>("/api/runs?page=1")
      .then(d => setRuns(d.rows.slice(0, 10)))
      .catch(() => setRuns([]));
  }, []);
```

统计卡用 `CARDS` 表驱动，避免五段几乎相同的 JSX。`failed_24h` 是唯一带 `alarm` 的一项。

图标名只用 `ui/icons.ts` 里已导出的那批（Task 3 Step 3）。这里不要写 `Activity` / `AlertTriangle` / `CheckCircle2` 这类没导出的名字，否则 typecheck 直接红。

- [ ] **Step 2: 续写 `Dashboard.tsx` —— 统计卡渲染**

```tsx
  return (
    <div>
      <PageHeader title="仪表盘" description="定时任务的运行概况。" />

      <div aria-busy={stats === null} className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats === null
          ? CARDS.map(c => <SkeletonCard key={c.key} />)
          : CARDS.map(c => {
              const v = stats[c.key];
              const hot = !!c.alarm && v > 0;
              return (
                <div key={c.key} className={cx(
                  "rounded-xl border p-4 transition-colors duration-fast ease-smooth",
                  hot ? "border-danger/40 bg-danger-soft" : "border-border bg-panel",
                )}>
                  <div className={cx("flex items-center gap-1.5 text-xs", hot ? "text-danger" : "text-fg-muted")}>
                    {c.icon}<span>{c.label}</span>
                  </div>
                  <p className={cx("mt-2 text-2xl font-semibold tabular-nums", hot && "text-danger")}>{v}</p>
                  {hot && (
                    <Link to="/runs?status=failed"
                      className="mt-1 inline-flex items-center gap-0.5 text-xs text-danger underline-offset-2 hover:underline">
                      查看失败记录<ArrowRight className="size-3" />
                    </Link>
                  )}
                </div>
              );
            })}
      </div>
```

统计卡不复用 `ui/Card`：`Card` 把 `border-border bg-panel` 写死了，而警示态要换成 `border-danger/40 bg-danger-soft`，包一层反而要打洞。这里手写 5 行 className 更干净。

数值一律 `tabular-nums`。等宽数字位可以避免 `9 → 10` 时整卡宽度跳一下。

「查看失败记录」直达 `/runs?status=failed`，依赖 Task 9 已把筛选状态搬到 URL 上。

- [ ] **Step 3: 收尾 `Dashboard.tsx` —— 最近运行时间线**

```tsx
      <h2 className="mb-3 text-sm font-medium">最近运行</h2>

      {runs === null ? (
        <Card>
          <div aria-busy="true" className="divide-y divide-border/60">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="ml-auto h-4 w-32" />
              </div>
            ))}
          </div>
        </Card>
      ) : runs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox className="size-6" />}
            title="暂无运行记录"
            description="任务第一次触发之后，这里会显示最近 10 条。"
          />
        </Card>
      ) : (
        <Card className="divide-y divide-border/60">
          {runs.map(r => {
            const failed = r.status === "failed";
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                {failed
                  ? <CircleX className="size-4 shrink-0 text-danger" />
                  : <CircleCheck className="size-4 shrink-0 text-success" />}
                <span className="min-w-0 truncate font-medium">{r.job_name ?? `任务#${r.job_id}`}</span>
                <span className="text-xs text-fg-subtle">{r.source === "manual" ? "手动" : "定时"}</span>
                {failed && r.http_status
                  ? <span className="font-mono text-xs text-danger">HTTP {r.http_status}</span>
                  : null}
                <span className="ml-auto text-xs whitespace-nowrap text-fg-muted tabular-nums">
                  {fmtShort(r.triggered_at)} · {relativeTime(r.triggered_at)}
                </span>
              </div>
            );
          })}
          <Link to="/runs"
            className="flex items-center justify-center gap-1 px-4 py-2.5 text-xs text-accent transition-colors duration-fast ease-smooth hover:bg-panel-hover">
            查看全部运行记录<ArrowRight className="size-3" />
          </Link>
        </Card>
      )}
    </div>
  );
}
```

表格换成时间线：只有 4 列信息，其中 3 列极短，用表格是把「时间 任务 来源 状态」四个表头的宽度约束强加到内容上。时间线一行一条，图标承载状态，右侧时间靠 `ml-auto` 推到边，窄屏靠 `flex-wrap` 自然堆叠。

条数从 20 降到 10。仪表盘要的是「扫一眼」，20 条会把统计卡挤出首屏。看全部走底部链接。

- [ ] **Step 4: 验证**

```bash
npm run typecheck && npm run test && npm run build
```

预期：全绿。

`npm run dev` 后人工核验：

| 项 | 期望 |
|---|---|
| 首屏加载 | 5 张 `SkeletonCard` + 5 行时间线骨架，不是空白闪现 |
| `failed_24h > 0` | 该卡转红色描边 + `danger-soft` 底，数值变红，出现「查看失败记录」 |
| 点「查看失败记录」 | 跳到 `/runs?status=failed`，运行记录页的分段控件停在「失败」 |
| `failed_24h === 0` | 该卡与其他四张完全一致，无红色，无链接 |
| 时间线 | 成功绿勾、失败红叉；失败条附 `HTTP 404` |
| 时间显示 | `08-31 13:45 · 2 小时前` |
| 无记录 | `EmptyState`，不是一行灰字 |
| 底部链接 | 跳 `/runs`（无 query），悬停有底色 |
| 窄屏 | 统计卡两列；时间线右侧时间换行到下一行而不是溢出 |
| 深色模式 | 警示卡是深红底，不是刺眼的浅红 |

- [ ] **Step 5: Commit**

```bash
git add src/client/pages/Dashboard.tsx
git commit -m "refactor(client): 仪表盘统计卡加语义图标与失败直达，最近运行改时间线"
```

---

### Task 11: 登录页重写

**Files:**
- Rewrite: `src/client/pages/Login.tsx`

**Interfaces:**
- Consumes: Task 3 的 `Button` `Input` `Field`；Task 6 的 `ThemeToggle`；Task 1 的 `animate-shake`
- Produces: 无（页面组件）

登录页在 `Layout` 之外（见 `App.tsx` 的路由），所以它要自己铺 `bg-surface text-fg`，也要自己放主题切换入口。

- [ ] **Step 1: 重写 `src/client/pages/Login.tsx`**

```tsx
import { useState } from "react";
import { post } from "../api";
import ThemeToggle from "../components/ThemeToggle";
import { Button, Field, Input } from "../ui";
import { KeyRound } from "../ui/icons";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/login", { password });
      location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setShaking(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface text-fg">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-start justify-center px-4 pb-24 sm:items-center sm:pb-32">
        <form
          onSubmit={submit}
          onAnimationEnd={() => setShaking(false)}
          className={shaking ? "w-full max-w-80 animate-shake" : "w-full max-w-80"}
        >
          <div className="rounded-2xl border border-border bg-panel p-7 shadow-sm">
            <div className="mb-6 flex flex-col items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-fg text-surface">
                <KeyRound className="size-5" />
              </div>
              <div className="text-center">
                <h1 className="text-base font-semibold">Actions Cronhub</h1>
                <p className="mt-0.5 text-xs text-fg-muted">输入管理密码以继续</p>
              </div>
            </div>

            <Field label="管理密码" error={error || null}>
              {({ id, describedBy }) => (
                <Input id={id} type="password" autoFocus autoComplete="current-password"
                  aria-describedby={describedBy} invalid={!!error}
                  value={password} onChange={e => setPassword(e.target.value)} />
              )}
            </Field>

            <Button type="submit" variant="primary" className="w-full" loading={busy}
              disabled={password.length === 0}>登录</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

抖动用 `shaking` 布尔态 + `onAnimationEnd` 复位，而不是 `key={nonce}` 强制重挂载——重挂载会丢掉输入框的焦点，用户还得手动点回去。复位之后下一次报错能再次触发。`prefers-reduced-motion` 下动画时长被压到 `0.01ms`，`animationend` 依然会触发，不会卡在 `shaking === true`。

错误信息挂在 `Field` 的 `error` 上（带 `role="alert"`），读屏软件会主动念出来。旧版是一个纯视觉的红色 div。

品牌标记用 `bg-fg text-surface`（近黑底/深色模式下近白底），与主按钮同一套强调逻辑。

- [ ] **Step 2: 验证**

```bash
npm run typecheck && npm run test && npm run build
```

预期：全绿。

`npm run dev` 后人工核验：

| 项 | 期望 |
|---|---|
| 打开 `/login` | 密码框自动聚焦；登录按钮因空密码而禁用 |
| 输错密码 | 卡片左右抖一下（160ms），错误文字出现在密码框下方 |
| 再输错一次 | **再次**抖动（不是只抖第一次） |
| 抖动结束后继续输入 | 不再抖，焦点仍在密码框里 |
| 输对密码 | 按钮进 loading 态，随后跳到 `/` |
| 右上角主题切换 | 三态可切，切换即时生效，刷新后保持 |
| 深色模式刷新 | 不闪白屏（Task 1 的内联脚本） |
| 系统开启「减弱动效」 | 无抖动，但错误文字照常显示 |

- [ ] **Step 3: Commit**

```bash
git add src/client/pages/Login.tsx
git commit -m "refactor(client): 登录页精修，错误抖动反馈与主题切换入口"
```

---

### Task 12: 全站收尾与验收

**Files:**
- 只做检查与清理，理论上不新增文件。发现残留时按下面各步改对应文件。

**Interfaces:**
- Consumes: Task 1-11 的全部产出
- Produces: 无

这一步是「重构是否真的完成」的判据。前 11 个任务各自只保证自己那块，这里做全站横切检查。

- [ ] **Step 1: 确认服务端一行未动**

这是本轮最硬的约束（见 Global Constraints）。

Run:
```bash
git diff --stat main -- src/server src/worker.ts src/schema.sql test/
```
Expected: **无输出**。

若有输出，说明重构越界了，逐条回退那些改动再继续。`test/` 目录允许新增 Task 2 的三个 `client-*.test.ts`，但既有的服务端测试文件不许改——所以先看清是新增还是修改：

```bash
git diff --stat main -- test/
git status --short test/
```
Expected: 只有 `client-time.test.ts`、`client-validate.test.ts`、`client-schedule.test.ts` 是新增，其余为空。

- [ ] **Step 2: 扫残留的硬编码配色**

全站应当只用语义令牌（`bg-panel` / `text-fg-muted` / `border-border` …），不应再出现 `neutral-200 dark:neutral-800` 这种成对硬编码。

Run:
```bash
grep -rnE '(bg|text|border)-(neutral|gray|zinc|slate|red|emerald|green|indigo)-[0-9]' src/client/ index.html
```
Expected: **无输出**。

Run:
```bash
grep -rn 'dark:' src/client/
```
Expected: **无输出**。`.dark` 的差异全部收敛在 `index.css` 的 `:root` / `.dark` 两个块里，组件里不该再出现 `dark:` 变体。

有残留就改成语义令牌。`index.css` 本身不在检查范围内（那里定义变量，不含工具类）。

- [ ] **Step 3: 扫残留的原生 `confirm` 与旧 import**

Run:
```bash
grep -rnE '\bconfirm\(' src/client/ | grep -v 'useConfirm\|await confirm\|const confirm'
```
Expected: **无输出**（三处原生 `confirm()` 已全部换成 `useConfirm()`）。

Run:
```bash
grep -rn "fmtTime" src/client/api.ts
grep -rn "from 'lucide-react'\|from \"lucide-react\"" src/client/ --include=*.tsx
```
Expected: 两条都**无输出**。前者确认 `fmtTime` 已移出 `api.ts`（Task 2 Step 9），后者确认图标只从 `ui/icons.ts` 取。

Run:
```bash
git ls-files src/client/pages
```
Expected: 不含 `pages/Jobs.tsx` 与 `pages/Accounts.tsx`（已被 Task 7/8 的目录版取代），含 `pages/Jobs/` 与 `pages/Accounts/` 下的文件。

- [ ] **Step 4: 全量命令验证**

```bash
npm run typecheck
npm run test
npm run build
```

预期：三条全绿。`npm run test` 里服务端的 10 个测试文件必须全部通过——它们是「重构没误伤后端」的证据。

- [ ] **Step 5: 人工验收矩阵**

`npm run dev`，按下表逐格过。每一格都要看，不要抽样。

四页 × 三主题（浅色 / 深色 / 系统）× 两尺寸（桌面 ≥1280、窄屏 375）：

| 检查项 | 浅色 | 深色 | 系统 |
|---|---|---|---|
| 仪表盘：统计卡对齐、时间线可读、警示卡配色不刺眼 | ☐ | ☐ | ☐ |
| 账号页：卡片网格、状态徽章不被挤压变形 | ☐ | ☐ | ☐ |
| 任务页：列表行卡片四行层级清晰、开关状态明确 | ☐ | ☐ | ☐ |
| 运行记录：失败行底色与色带、展开的错误详情 | ☐ | ☐ | ☐ |
| 登录页：卡片居中、抖动反馈 | ☐ | ☐ | ☐ |

窄屏（375px）单独一轮：

| 项 | 期望 |
|---|---|
| 四页都不出现横向滚动条 | 唯一例外是运行记录的表格（既定决策：表格保留） |
| 汉堡按钮 → 抽屉导航 | 从左滑入，选中后自动关闭，背景不能滚动 |
| 任务卡片 | 操作区换行到卡片底部，不溢出 |
| 抽屉表单 | 占满宽度，底部保存栏吸底可见 |
| 确认框 | 不超出屏幕，按钮可点 |

三项跨页重点（这三条最容易在重构里退化）：

| 项 | 怎么验 | 期望 |
|---|---|---|
| **深色不闪白** | 主题设为深色 → 硬刷新（Ctrl+Shift+R）5 次 | 一次都不能看到白屏帧 |
| **乐观启停可回滚** | DevTools 断网 → 点任务开关 | 立即翻转 → 报错 toast → 自动翻回原状态 |
| **`enabled` 回归** | 停用一个任务 → 编辑它（只改任务名）→ 保存 | 保存后**仍是停用**。这条历史上是 bug，务必验 |

键盘与无障碍单独一轮（全程不碰鼠标）：

| 项 | 期望 |
|---|---|
| Tab 走查四页 | 焦点环始终可见（`ring-accent/40`），不丢焦点 |
| 任务开关 | 空格键可切换；读屏软件念出「开关 已选中/未选中」 |
| `⋯` 菜单 | Enter 打开、方向键移动、Esc 关闭并把焦点还给按钮 |
| 抽屉 / 确认框打开时 | Tab 焦点锁在弹层内，Esc 关闭 |
| 抽屉有未保存改动时按 Esc | 弹二次确认，而不是直接丢弃 |
| 运行记录失败行 | Tab 可达、Enter 展开 |

- [ ] **Step 6: 清理与最终提交**

```bash
git status --short
```

确认没有遗留的临时文件、`.only` 测试、注释掉的旧代码。

```bash
npm run build && git add -A && git commit -m "chore(client): 前端重构收尾，全站语义令牌与验收检查"
```

若前面各任务都已提交且本步无改动，`git commit` 会报 nothing to commit——那是正常结果，跳过即可。

---

## 完成判据

全部 12 个任务完成后：

- `npm run typecheck && npm run test && npm run build` 全绿
- `git diff --stat main -- src/server src/worker.ts src/schema.sql` 无输出
- `package.json` 的新增依赖**只有** `lucide-react`，且为精确版本
- `grep -rn 'dark:' src/client/` 无输出
- Task 12 Step 5 的验收矩阵全部打勾
