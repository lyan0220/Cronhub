import type { TextareaHTMLAttributes } from "react";
import { controlBase, controlError, cx } from "./styles";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export function Textarea({ invalid, className, ...rest }: Props) {
  return <textarea aria-invalid={invalid || undefined}
    className={cx(controlBase, "resize-y", invalid && controlError, className)} {...rest} />;
}
