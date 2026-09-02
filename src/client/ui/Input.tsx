import type { InputHTMLAttributes } from "react";
import { bareBase, controlBase, controlError, cx } from "./styles";

type Props = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; bare?: boolean };

export function Input({ invalid, bare, className, ...rest }: Props) {
  return <input aria-invalid={invalid || undefined}
    className={cx(bare ? bareBase : controlBase, invalid && controlError, className)} {...rest} />;
}
