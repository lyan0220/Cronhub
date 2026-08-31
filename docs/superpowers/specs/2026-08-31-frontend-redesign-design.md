# 前端视觉与交互重构 — 设计

日期：2026-08-31

范围：纯前端。改动限于 `src/client/`、`src/client/index.css`、`index.html`。服务端（`src/server/`、`src/worker.ts`）、API 契约、D1 schema 一行不动。

## 目标

把现有可用但朴素的 Tailwind 后台，改造成克制精致的现代管理界面，并补齐三块交互短板：加载与反馈、主题切换与响应式、表单与危险操作。

## 非目标

- 不改信息架构。仍是 仪表盘 / 账号 / 任务 / 运行记录 四页，路由不变。
- 不做命令面板、列表搜索排序、运行记录自动刷新、错误一键复制。本轮明确排除。
- 不引入前端测试框架（jsdom / testing-library）。
- 不改任何 API 请求或响应的形状。

## 已定决策

| 决策项 | 取值 |
|---|---|
| 视觉风格 | 中性灰阶打底 + 单一强调色，1px 细边框，极浅阴影，紧凑排版，靠微动效体现质感 |
| 新依赖 | 仅 `lucide-react`。动效用 Tailwind 过渡 + `@keyframes`，弹层用原生 `<dialog>` |
| 强调色 | 主按钮近黑（浅色 `neutral-900` 白字，深色模式反转为白底黑字）；indigo 仅用于导航激活态、链接、焦点环 |
| 任务列表形态 | 列表行卡片，一个任务一张横向卡片；同一套 DOM 在窄屏自然堆叠 |
| 交互范围 | 加载与反馈、主题切换与响应式、表单与危险操作 |

## 1. 令牌层

深色模式当前依赖 Tailwind v4 默认的 `prefers-color-scheme`，无法手动切换。改为 class 驱动。

`src/client/index.css` 重写为：

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --surface: #fafafa;      /* 页面底 */
  --panel: #ffffff;        /* 卡片、面板 */
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
}
```

`@theme inline` 是引用运行时 CSS 变量的必需写法。普通 `@theme` 会在构建期把值烧死，`.dark` 覆盖将失效。

之后全站统一用 `bg-panel` / `text-fg-muted` / `border-border` / `text-success`，不再出现 `neutral-200 dark:neutral-800` 这类成对硬编码。深浅两套配色收敛到上面两个块，改配色只改一处。

动效令牌同样在 `@theme` 中声明：`--duration-fast: 120ms`、`--duration-base: 180ms`、`--duration-slow: 240ms`，缓动统一 `cubic-bezier(0.32, 0.72, 0, 1)`。

全局兜底规则：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 2. UI 原语层

新目录 `src/client/ui/`。每个文件一个组件，只负责样式与无障碍，不含业务逻辑。

| 组件 | 职责 | 关键接口 |
|---|---|---|
| `Button.tsx` | 按钮 | `variant: "primary" \| "secondary" \| "ghost" \| "danger"`，`size: "sm" \| "md"`，`loading?: boolean`（自动 `disabled` 并内联 spinner），`icon?: ReactNode` |
| `Input.tsx` `Select.tsx` `Textarea.tsx` | 表单控件 | 共用一份基础样式常量，统一焦点环 `ring-2 ring-accent/40` |
| `Field.tsx` | 表单行容器 | `label`、`hint?`、`error?`，负责 `htmlFor` / `aria-describedby` / `aria-invalid` 串联 |
| `Card.tsx` | 面板容器 | `interactive?`（悬停时边框与背景变化） |
| `Badge.tsx` | 语义徽章 | `tone: "success" \| "danger" \| "warn" \| "neutral"`，可带图标 |
| `Switch.tsx` | 启停开关 | `checked`、`onChange`、`disabled`；`role="switch"` + `aria-checked` |
| `Dialog.tsx` | 模态框底座 | 基于原生 `<dialog>`，`showModal()` 提供焦点锁定与 Esc 关闭 |
| `ConfirmDialog.tsx` | 危险操作确认 | 导出 `useConfirm()`，返回 `confirm(opts) => Promise<boolean>` |
| `Drawer.tsx` | 右侧抽屉 | Esc 关闭、焦点锁定、脏态时二次确认、滑入动画 |
| `Skeleton.tsx` | 骨架占位 | `Skeleton`、`SkeletonText`、`SkeletonCard` |
| `EmptyState.tsx` | 空态 | `icon`、`title`、`description`、`action?` |
| `Menu.tsx` | `⋯` 下拉菜单 | 键盘可达（方向键、Enter、Esc），点击外部关闭 |
| `icons.ts` | 图标出口 | 从 `lucide-react` 按需再导出，全站只从这里取图标 |

`Dialog` 用原生 `<dialog>` 而非手写覆盖层：焦点陷阱、Esc 关闭、`::backdrop`、惰性化背景内容都由浏览器提供，省掉一整套易错的手写焦点管理。

`useConfirm()` 采用命令式 API，因为它要替换的三处 `confirm()` 都在 async 函数中间：

```tsx
const confirm = useConfirm();
async function remove(j: Job) {
  const ok = await confirm({
    title: `删除任务「${j.name}」？`,
    description: "该任务的全部运行记录会一并删除，且无法恢复。",
    confirmText: "删除",
    tone: "danger",
  });
  if (!ok) return;
  // ...
}
```

`ConfirmDialog` 的 provider 挂在 `App.tsx`，与 `ToastProvider` 同层。

## 3. Layout 与主题

### 主题切换

新增 `src/client/theme.ts`：三态 `"system" | "light" | "dark"`，存 `localStorage.theme`，解析为实际配色后在 `document.documentElement` 上增删 `.dark`；`system` 态监听 `matchMedia("(prefers-color-scheme: dark)")` 的变化。导出 `useTheme()`。

`index.html` 的 `<head>` 末尾加一段内联脚本，在 React 挂载前完成首次判定：

```html
<script>
  try {
    var t = localStorage.getItem("theme") || "system";
    var dark = t === "dark" || (t === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
</script>
```

没有这段脚本，深色模式用户每次刷新都会先闪一帧白屏。这是首屏闪白（FOUC）唯一可靠的解法，必须内联、必须在 `<head>` 内。

### Layout

- 桌面（`≥ lg`）：左侧固定栏 224px。品牌标记 + 导航（图标 + 文字 + 计数徽章）+ 底部主题切换与退出登录。
- 导航激活态：2px indigo 左侧指示条 + `bg-panel-hover` 淡底 + 文字转为 `text-fg`。取代当前的整块实心 indigo 背景。
- 窄屏（`< lg`）：侧边栏收起，改为顶部条（品牌 + 汉堡按钮 + 主题切换），点击滑出抽屉式导航，选中后自动关闭。
- 内容区：`max-w-6xl` 居中并留出左右内边距。当前是撑满宽度，超宽屏上表格会拉散。
- 计数徽章的数据来自 `/api/stats`（`total_jobs`、`accounts`），在 Layout 内拉取一次。

### PageHeader

新增 `src/client/components/PageHeader.tsx`：标题 + 一句说明 + 右侧主操作插槽。四页统一使用，替换当前各页手写的 `flex items-center justify-between` + `h1`。

## 4. 页面重构

### 4.1 仪表盘

- 5 张统计卡加语义图标，数值用 `tabular-nums` 防跳动。
- 「近 24h 失败」在数值大于 0 时转为红色描边 + `danger-soft` 底，并显示「查看失败记录」链接，直达 `/runs?status=failed`。`Runs` 页需读取 URL query 初始化筛选状态。
- 「最近运行」从表格改为紧凑时间线：每行左侧成功/失败图标，中间任务名 + 来源，右侧相对时间（`13:45 · 2 小时前`）。
- 首屏加载显示 `SkeletonCard × 5` + 时间线骨架，取代当前的空白闪现。
- 空态使用 `EmptyState`（当前是一行灰字）。

### 4.2 任务页

拆分为 `src/client/pages/Jobs/`：

| 文件 | 内容 |
|---|---|
| `index.tsx` | 数据拉取、列表渲染、增删改状态编排 |
| `JobRow.tsx` | 单个任务的列表行卡片 |
| `JobForm.tsx` | 抽屉内表单 |
| `ScheduleEditor.tsx` | 调度规则编辑器（从现文件原样迁出后再改造） |
| `schedule.ts` | `parseSchedule`、`describeLocal`、`relativeTime` 等纯函数 |

当前 `Jobs.tsx` 287 行把四件事挤在一处，拆分后每个文件职责单一。

列表行卡片布局（三行信息层级）：

```
┌───────────────────────────────────────────────┐
│  每日构建                        ● 启用  ⋯  │
│  ⑂ alice/repo1  ·  build.yml @ main         │
│  ⏱ 每 45 分钟    → 下次 08-31 14:30           │
│  ✓ 上次 13:45 成功                            │
└───────────────────────────────────────────────┘
```

- 第一行：任务名（`font-medium`）+ 右侧 `Switch` + `Menu`。
- 第二行：仓库与触发目标，等宽字体，`text-fg-muted`。
- 第三行：调度描述 + 下次触发（带相对时间）。
- 第四行：上次运行结果，成功/失败用语义色与图标；失败时附 HTTP 码。
- 悬停：边框转 `border-strong`、背景转 `panel-hover`。不做位移抬升 —— 密集列表里逐个跳动会造成视觉噪音。
- 窄屏：右侧操作区换行到卡片底部，无需另写一套布局。

交互：

- **乐观启停**：点击 `Switch` 立即翻转本地状态，同时发 `POST /api/jobs/:id/toggle`；失败则回滚并弹错误 toast。
- **立即触发**：按钮自身进 loading 态，完成后在该卡片第四行就地回显本次结果，而不是只弹一个 toast 就消失。
- **删除**：走 `useConfirm()`，文案说明运行记录会一并删除。

抽屉表单（`JobForm.tsx`）：

- 分三组，每组带小标题：**基本信息**（任务名、账号、仓库）、**触发方式**（分段控件 + 对应字段）、**调度规则**。
- 即时校验，失焦时触发，错误挂在 `Field` 的 `error` 上：
  - 仓库须匹配 `^[\w.-]+/[\w.-]+$`；
  - `inputs_json` 非空时须能 `JSON.parse` 且结果为对象；
  - cron 表达式复用 `/api/cron/preview` 的报错（现已有，只是展示位置从底部提示改为字段级错误）；
  - 账号未选（`account_id === 0`）时禁用保存。
- Esc 关闭；有未保存改动时 Esc 与点击遮罩都走二次确认。
- 保留现有的未来触发时间预览（400ms 防抖），每条时间后补相对时间。
- **保留 `enabled` 回传逻辑**。现文件 [`Jobs.tsx:139-141`](../../../src/client/pages/Jobs.tsx#L139) 有注释说明：表单不含 `enabled`，而后端缺省置 1，编辑时必须回传原值，否则停用的任务会被静默启用。重构时这段逻辑与注释一并保留。

### 4.3 账号页

- 卡片精修：备注名 + `@login` + 指纹（等宽）+ 上次验证时间。
- 状态徽章改用 `Badge`，带图标。
- 「重新验证」按钮进 loading 态。
- 「删除」走 `useConfirm()`，文案点明该账号下的任务与运行记录会一并删除。
- 「添加账号」保留当前的就地展开面板（只有 3 个字段，抽屉是过度设计），仅用新原语重写样式，并加展开/收起过渡。
- 原地编辑（`EditableCard`）保留现有行为，改用新原语重写。就地添加与就地编辑保持同一种交互模式，不混用抽屉。
- 首屏骨架 + `EmptyState`。

### 4.4 运行记录页

- 状态筛选改为分段控件（全部 / 成功 / 失败），任务筛选保留下拉。
- 支持从 URL query 初始化 `status` 与 `job_id`，以配合仪表盘的直达链接。
- 表格保留，但每行左侧加 2px 状态色带；失败行底色改用 `danger-soft`。
- 失败行点击展开错误详情的行为保留。
- 「清理 90 天前记录」走 `useConfirm()`。
- 分页控件加总数与页码信息；加载中显示行骨架。

### 4.5 登录页

- 卡片精修：品牌标记 + 标题 + 密码框 + 主按钮。
- 密码错误时输入框轻微左右抖动（`@keyframes shake`，160ms）。
- 右上角放主题切换入口。

## 5. 动效规则

统一约束，避免各处随意设值：

| 场景 | 时长 | 属性 |
|---|---|---|
| 按钮、链接、卡片悬停 | `--duration-fast` 120ms | `background-color`、`border-color` |
| Toast、Dialog、Menu 进出 | `--duration-base` 180ms | `opacity`、`transform: scale/translateY` |
| Drawer 滑入滑出 | `--duration-slow` 240ms | `transform: translateX` |
| 骨架屏呼吸 | 1.5s 循环 | `opacity` |

- 只动 `transform` 与 `opacity`（悬停的颜色过渡除外），不动 `width` / `height` / `top` 等触发重排的属性。
- 缓动统一 `cubic-bezier(0.32, 0.72, 0, 1)`。
- 全部受 `prefers-reduced-motion` 兜底规则约束。
- Toast 补进出场动画与手动关闭按钮，当前是直接出现和消失。

## 6. 一并修复的既有问题

这些是重构中顺带解决的实际缺陷，不属于额外范围扩张：

| 问题 | 位置 | 修复 |
|---|---|---|
| `inputCls` 类名串重复三份 | [`Jobs.tsx:174`](../../../src/client/pages/Jobs.tsx#L174)、[`Accounts.tsx:42`](../../../src/client/pages/Accounts.tsx#L42)、[`Login.tsx:29`](../../../src/client/pages/Login.tsx#L29) | 收口到 `ui/Input.tsx` |
| 状态徽章无深色变体，`bg-emerald-100` 在深色底上刺眼 | [`Accounts.tsx:8-10`](../../../src/client/pages/Accounts.tsx#L8) | 改用语义令牌 |
| 启停开关是裸 `<button>`，无 `role` / `aria-checked`，读屏软件读不出状态 | [`Jobs.tsx:204`](../../../src/client/pages/Jobs.tsx#L204) | `ui/Switch.tsx` 补齐 ARIA |
| 三处原生 `confirm()` | [`Jobs.tsx:168`](../../../src/client/pages/Jobs.tsx#L168)、[`Accounts.tsx:112`](../../../src/client/pages/Accounts.tsx#L112)、[`Runs.tsx:29`](../../../src/client/pages/Runs.tsx#L29) | `ConfirmDialog` |
| 侧边栏无响应式，9 列任务表在手机上只能横向滚动 | [`Layout.tsx:19`](../../../src/client/components/Layout.tsx#L19)、`Jobs.tsx` | 抽屉导航 + 列表行卡片 |
| 深色模式无法手动切换 | 全局 | class 驱动 + `theme.ts` |

## 7. 重构后的文件结构

```
src/client/
  index.css          # 令牌层，重写
  main.tsx           # 不变
  App.tsx            # 增挂 ConfirmProvider
  api.ts             # 增 relativeTime 或移入 utils
  types.ts           # 不变
  theme.ts           # 新增
  ui/                # 新增：15 个文件（14 个原语 + icons.ts）
  components/
    Layout.tsx       # 重写
    PageHeader.tsx   # 新增
    RequireAuth.tsx  # 不变
    Toast.tsx        # 加动画与关闭按钮
  pages/
    Dashboard.tsx
    Accounts.tsx
    Runs.tsx
    Login.tsx
    Jobs/            # 由原 Jobs.tsx 拆出
      index.tsx  JobRow.tsx  JobForm.tsx  ScheduleEditor.tsx  schedule.ts
```

## 8. 验证

不引入前端测试框架 —— 那会带进 jsdom 与 testing-library，与「仅图标库」的依赖约束冲突。

可测的纯逻辑抽成纯函数，加进现有 vitest（无需新依赖）：

- `pages/Jobs/schedule.ts` 的 `describeLocal`、`parseSchedule`（含非法 JSON 兜底）；
- 相对时间格式化 `relativeTime`；
- 表单校验函数（仓库格式、`inputs_json` 必须解析为对象）。

其余靠命令与人工验收：

1. `npm run typecheck`
2. `npm run test` — 确认服务端 10 个测试文件全绿，重构未误伤后端
3. `npm run build`
4. `npm run dev` — 人工过 4 页 × 浅色/深色/系统 × 桌面/窄屏；重点核验刷新时深色模式不闪白、乐观启停失败能回滚、抽屉脏态二次确认生效

