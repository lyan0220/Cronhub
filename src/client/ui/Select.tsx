import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "./icons";
import { bareBase, controlBase, controlError, cx } from "./styles";

type Props = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; bare?: boolean };

export function Select({ invalid, bare, className, children, ...rest }: Props) {
  return (
    <div className="relative">
      <select aria-invalid={invalid || undefined}
        className={cx(bare ? bareBase : controlBase, "appearance-none pr-9", invalid && controlError, className)} {...rest}>
        {children}
      </select>
      <ChevronDown aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-subtle" />
    </div>
  );
}
