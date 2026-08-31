import type { InputHTMLAttributes } from "react";
import { controlBase, controlError, cx } from "./styles";

type Props = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function Input({ invalid, className, ...rest }: Props) {
  return <input aria-invalid={invalid || undefined}
    className={cx(controlBase, invalid && controlError, className)} {...rest} />;
}
