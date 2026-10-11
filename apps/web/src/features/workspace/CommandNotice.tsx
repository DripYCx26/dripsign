"use client";

import type { ActionFailure } from "@/server/action.ts";
import { Banner, Button, Notice } from "@/ui";

type CommandNoticeProps = Readonly<{
  error: ActionFailure | null;
  onReload: () => void;
  /** `page` is the strip under the header; `panel` sits inside a drawer or dialog. */
  placement: "page" | "panel";
  /** A more specific sentence for a rate-limit refusal than the server's generic one. */
  rateLimited?: string | undefined;
}>;

/**
 * Why the last command did not land, in the server's own sentence. A conflict or an unknown outcome
 * offers a reload first, so a second try never repeats a command whose first try may have worked;
 * the composer's text is untouched by all of them.
 */
export function CommandNotice({ error, onReload, placement, rateLimited }: CommandNoticeProps) {
  if (error === null) return null;
  const reloadable = error.code === "conflict" || error.code === "unavailable";
  const tone = reloadable ? "attention" : "stop";
  const text = error.code === "rate_limited" ? (rateLimited ?? error.message) : error.message;
  const reload = reloadable ? (
    <Button variant="secondary" size="sm" onClick={onReload}>
      Reload
    </Button>
  ) : undefined;
  if (placement === "page") {
    return (
      <Banner tone={tone} live="alert" action={reload}>
        {text}
      </Banner>
    );
  }
  return (
    <Notice tone={tone} live="alert">
      <p>{text}</p>
      {reload}
    </Notice>
  );
}
