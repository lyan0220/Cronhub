import { useEffect, useRef } from "react";

/**
 * 定时自动刷新：间隔到期且页面可见（document.visibilityState）时调用 fn。
 * - enabled=false 时整个不启动（如弹窗/抽屉打开期间暂停，避免与表单快照竞态）。
 * - fn 存进 ref 每次渲染更新，调用方直接传内联函数即可，无需 useCallback。
 */
export function useAutoRefresh(fn: () => void, ms: number, enabled = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") ref.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}
