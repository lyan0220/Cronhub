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
