import { useEffect, useState } from "react";
import { get } from "../api";

// 认证守卫：挂载时先校验会话，校验期间不渲染任何后台 UI，
// 避免未登录访问 /jobs 等路径时后台页面骨架先闪现再跳登录
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    get("/api/auth/me")
      .then(() => setAuthed(true))
      .catch(() => {
        location.href = "/login";
      })
      .finally(() => setChecking(false));
  }, []);

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500">
        {checking ? "加载中…" : "正在跳转登录页…"}
      </div>
    );
  }
  return <>{children}</>;
}
