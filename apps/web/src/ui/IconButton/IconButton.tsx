import type { MouseEvent, ReactNode } from "react";
import styles from "./IconButton.module.css";
import type { ButtonSize, ButtonVariant } from "../Button/Button.tsx";

type IconButtonProps = Readonly<{
  /** The accessible name, rendered as `aria-label`: an icon alone says nothing to a screen reader. */
  label: string;
  /** The glyph, an icon from `../icons.tsx`. */
  icon: ReactNode;
  variant?: Exclude<ButtonVariant, "link"> | undefined;
  size?: Exclude<ButtonSize, "lg"> | undefined;
  type?: "button" | "submit" | undefined;
  disabled?: boolean | undefined;
  onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
}>;

/** A square button holding one glyph; every state is Button's. */
export function IconButton({
  label,
  icon,
  variant = "quiet",
  size = "md",
  type = "button",
  disabled = false,
  onClick,
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={styles.iconButton}
      data-variant={variant}
      data-size={size}
      data-tone={variant === "danger" ? "stop" : undefined}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
