import { useCallback, useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

/** localStorage 的 key。与 index.html 的内联防闪脚本保持同步（key、"dark" 类名、解析规则三处都写了一遍，改这里必须同时改那边）。 */
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

// 模块级单一真相源。ThemeToggle 会同时挂在桌面侧栏与窄屏抽屉两处（用 CSS 隐藏而非卸载），
// 若每个 useTheme 各持一份 useState，在一处改主题另一处的高亮不会跟着变，
// 且失效那一份残留的 matchMedia 监听会在系统换色时盖掉用户刚选的偏好。
let current: ThemePref | null = null;
const subscribers = new Set<(p: ThemePref) => void>();

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(() => (current ??= readThemePref()));

  const setPref = useCallback((p: ThemePref) => {
    current = p;
    try { localStorage.setItem(KEY, p); } catch { /* 同上 */ }
    applyTheme(p);
    subscribers.forEach(fn => fn(p));
  }, []);

  useEffect(() => {
    subscribers.add(setPrefState);
    return () => { subscribers.delete(setPrefState); };
  }, []);

  // 挂载时先同步一次：内联防闪脚本可能因 localStorage 抛异常或存了异常值而算出
  // 与 React 状态不一致的结果，这里让 pref 成为唯一真相源。
  // system 态下再跟随系统实时变化。
  useEffect(() => {
    applyTheme(pref);
    if (pref !== "system") return;
    const mq = matchMedia(MQ);
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  return { pref, setPref };
}
