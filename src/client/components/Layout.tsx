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
