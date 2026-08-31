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

export default function Layout() {
  const nav = useNavigate();
  const loc = useLocation();
  const [stats, setStats] = useState<Stats | null>(null);
  const [open, setOpen] = useState(false);

  // 路由变化就重新拉计数：新建或删除任务/账号后，徽章不会停在旧值。
  useEffect(() => { get<Stats>("/api/stats").then(setStats).catch(() => {}); }, [loc.pathname]);

  // 抽屉打开期间锁背景滚动，并支持 Esc 关闭。
  // 同时监听断点：拉宽到 ≥ lg 时抽屉与汉堡都被 CSS 隐藏，但 open 仍为 true——
  // 滚动锁不会解除，而界面上已经没有可见的关闭入口。所以断点一过就强制收起。
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const mq = matchMedia("(min-width: 1024px)");
    const onWide = () => { if (mq.matches) setOpen(false); };
    onWide();
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onWide);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onWide);
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
