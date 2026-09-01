import { useEffect, useRef } from "react";

/**
 * 组件存活标记。异步响应回来时组件可能已因切路由卸载——对已卸载组件 setState
 * 在 React 18 不再警告，但仍是真实的写入竞态。在 then/catch 里判 alive.current。
 *
 * 适用「挂载时拉一次」的页面（Dashboard/Jobs/Accounts）。Runs/Layout 那种
 * 依赖变化就重新发请求的场景，先发后到的旧响应同样会覆盖新响应，那里需要
 * effect 内局部的 alive 变量（每次运行各一个），不能用这个共享 ref。
 *
 * effect 体里要把标记重置回 true：StrictMode 的挂载序列是 effect → cleanup →
 * effect，cleanup 置 false 后若不恢复，第二遍挂载的请求会永远被当成"已卸载"。
 */
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  return alive;
}
