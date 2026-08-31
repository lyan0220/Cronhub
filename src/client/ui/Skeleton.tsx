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
