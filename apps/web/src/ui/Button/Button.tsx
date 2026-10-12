"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { LoaderCircle } from "../icons.tsx";
import styles from "./Button.module.css";

/** The kinds of action; link reads as a link and stays in place. */
export type ButtonVariant = "ink" | "secondary" | "quiet" | "danger" | "link";

/** Control heights 32, 36 and 44 (`--ds-size-control-*`); 44 on a coarse pointer. */
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = Readonly<{
  variant: ButtonVariant;
  size?: ButtonSize | undefined;
  type?: "button" | "submit" | undefined;
  /** Work in flight: the button keeps focus and its words, shows a spinner, and does nothing. */
  loading?: boolean | undefined;
  /** A toggle's state, exposed as `aria-pressed`; omit for an ordinary action. */
  pressed?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  children: ReactNode;
}>;

/**
 * The one button. A native `<button>`. While loading it stays focusable (`aria-busy`,
 * `aria-disabled`) so a screen-reader user is not thrown out of the form mid-submit; a click or an
 * implicit submit is cancelled instead.
 */
export function Button({
  variant,
  size = "md",
  type = "button",
  loading = false,
  pressed,
  disabled = false,
  onClick,
  children,
}: ButtonProps) {
  return (
    <button
      type={type}
      className={styles.button}
      data-variant={variant}
      data-size={size}
      data-tone={variant === "danger" ? "stop" : undefined}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      disabled={disabled}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {loading && <LoaderCircle className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}

type ButtonLinkProps = Readonly<{
  variant: ButtonVariant;
  size?: ButtonSize | undefined;
  href: string;
  children: ReactNode;
}>;

/** A navigation that looks like a Button: a real link, so it opens in a new tab and is announced as one. */
export function ButtonLink({ variant, size = "md", href, children }: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={styles.button}
      data-variant={variant}
      data-size={size}
      data-tone={variant === "danger" ? "stop" : undefined}
    >
      {children}
    </Link>
  );
}
