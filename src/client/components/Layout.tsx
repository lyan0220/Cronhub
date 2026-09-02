import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { get, post } from "../api";
import type { Stats } from "../types";
import { Menu } from "../ui";
import {
  ChevronDown, KeyRound, LayoutDashboard, LogOut, Menu as MenuIcon, ScrollText, Timer, UserRound, Users, X,
  type LucideIcon,
} from "../ui/icons";
import { cx, focusRing } from "../ui/styles";
import { Logo } from "./Logo";
import PasswordDialog from "./PasswordDialog";
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

const iconBtn = cx(
  "rounded-md p-1 text-fg-muted transition-colors duration-fast ease-smooth",
  "hover:bg-panel-hover hover:text-fg",
  focusRing,
);

function NavItems({ stats, onNavigate }: { stats: Stats | null; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {LINKS.map(({ to, label, end, Icon, count }) => (
        <NavLink key={to} to={to} end={end} onClick={onNavigate}
          className={({ isActive }) => cx(
            "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm",
            "transition-colors duration-fast ease-smooth",
            "before:absolute before:top-1/2 before:left-0 before:h-4 before:w-0.5",
            "before:-translate-y-1/2 before:rounded-full before:bg-fg",
            "before:transition-opacity before:duration-fast",
            focusRing,
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

export default function Layout() {
  const nav = useNavigate();
  const loc = useLocation();
  const [stats, setStats] = useState<Stats | null>(null);
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);

  // 路由切换就重新拉计数。alive 标记有两个作用：快速连切路由时先发后到的旧响应
  // 不会覆盖新响应（否则删掉一个任务再切页，徽章会退回删除前的值），
  // 以及退出登录卸载 Layout 后不再对已卸载组件 setState。
  // 已知局限：任务/账号的新建与删除走同页抽屉（不换路由），那时徽章仍停在旧值。
  useEffect(() => {
    let alive = true;
    get<Stats>("/api/stats").then(s => { if (alive) setStats(s); }).catch(() => {});
    return () => { alive = false; };
  }, [loc.pathname]);

  // 抽屉用原生 <dialog> + showModal()：焦点约束、Esc 关闭、::backdrop、背景惰性
  // 全部由浏览器负责，关闭时焦点还会自动归还给汉堡按钮。手写覆盖层这些都要自己实现，
  // 而且上一版就漏了焦点约束——Tab 会走进遮罩背后的正文。
  useEffect(() => {
    const el = drawerRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // 拉宽到 ≥ lg 时汉堡被 CSS 隐藏，界面上已没有可见的关闭入口，所以断点一过就强制收起。
  // 断点必须用 rem：Tailwind 的 lg 是 64rem，会随浏览器默认字号缩放。写死 1024px 时，
  // 用户把默认字号调大后 CSS 仍判定窄屏（显示汉堡）而 JS 已判定宽屏，
  // 点汉堡会被立刻强制收起，导航彻底不可达。
  useEffect(() => {
    if (!open) return;
    const mq = matchMedia("(min-width: 64rem)");
    const onWide = () => { if (mq.matches) setOpen(false); };
    onWide();
    mq.addEventListener("change", onWide);
    return () => mq.removeEventListener("change", onWide);
  }, [open]);

  async function logout() {
    await post("/api/auth/logout");
    nav("/login");
  }

  const brand = (
    <div className="flex items-center gap-2">
      <Logo className="size-7" />
      <span className="truncate text-base font-semibold tracking-tight text-fg">Actions Cronhub</span>
    </div>
  );

  const footer = (
    <div className="mt-auto flex flex-col gap-3 pt-4">
      <ThemeToggle />
      {/* 账户菜单：修改密码与退出登录收进一个 chip，弹出面板向上展开 */}
      <Menu
        label="账户"
        dropUp
        triggerClassName={cx(
          "flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-left",
          "transition-colors duration-fast ease-smooth hover:border-border-strong hover:bg-panel",
        )}
        trigger={
          <>
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fg text-surface">
              <UserRound className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">管理员</span>
            <ChevronDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          </>
        }
        items={[
          { label: "修改密码", icon: <KeyRound className="size-3.5" />, onSelect: () => setPwOpen(true) },
          { label: "退出登录", icon: <LogOut className="size-3.5" />, onSelect: () => void logout(), tone: "danger" },
        ]}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-surface text-fg">
      {/* 桌面固定侧栏（≥ lg）。overflow-y-auto：横屏手机等极矮视口下 footer 不至于被裁掉且无法滚动。 */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col overflow-y-auto border-r border-border bg-panel p-4 lg:flex">
        {brand}
        <div className="mt-6"><NavItems stats={stats} /></div>
        {footer}
      </aside>

      {/* 窄屏抽屉导航（< lg）。始终挂载，由 showModal()/close() 控制显隐——
          <dialog> 需要节点存在才能拿到 ref。 */}
      <dialog ref={drawerRef} aria-label="导航"
        onClose={() => setOpen(false)}
        onClick={e => { if (e.target === drawerRef.current) setOpen(false); }}
        className={cx(
          "mr-auto ml-0 h-full max-h-full w-64 max-w-full",
          "rounded-none border-r border-border bg-panel p-0 text-fg",
          "open:animate-in-left backdrop:bg-black/50",
        )}>
        <div className="flex h-full flex-col overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-2">
            {brand}
            <button type="button" onClick={() => setOpen(false)} aria-label="关闭导航"
              className={iconBtn}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="mt-6"><NavItems stats={stats} onNavigate={() => setOpen(false)} /></div>
          {footer}
        </div>
      </dialog>

      <div className="lg:pl-64">
        {/* 窄屏顶部条 */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-panel/85 px-4 py-3 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="打开导航" aria-expanded={open}
            className={iconBtn}>
            <MenuIcon className="size-5" aria-hidden />
          </button>
          {brand}
        </header>

        {/* 内容区在侧栏以外的剩余空间里居中（上限 1440px）：完全不限宽会拉伸到
            交互难受，靠左又会右重左轻；居中后 1920 宽下侧栏与内容的间距收敛到
            约 112px 且左右对称，视口再大也是对称留白，观感是「刻意留白」而不是割裂。 */}
        <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      {pwOpen && <PasswordDialog open onClose={() => setPwOpen(false)} />}
    </div>
  );
}
