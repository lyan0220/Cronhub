import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "./icons";
import { controlBase, controlError, cx } from "./styles";

type Props = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export function Select({ invalid, className, children, ...rest }: Props) {
  return (
    <div className="relative">
      <select aria-invalid={invalid || undefined}
        className={cx(controlBase, "appearance-none pr-9", invalid && controlError, className)} {...rest}>
        {children}
      </select>
      <ChevronDown aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-subtle" />
    </div>
  );
}
