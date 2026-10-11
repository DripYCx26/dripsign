"use client";

import { useRouter } from "next/navigation";

/**
 * Which revision the pane shows lives in `?rev=`, so a view can be linked and survives a reload.
 * The returned function sets it, or clears it for `null` (the pane's default). It reads the
 * address when called, so it keeps the other parameters (`?tab=`) as they are now.
 */
export function useRevisionParam(): (rev: string | null) => void {
  const router = useRouter();
  return (rev) => {
    const params = new URLSearchParams(window.location.search);
    if (rev === null) params.delete("rev");
    else params.set("rev", rev);
    const query = params.toString();
    const { pathname } = window.location;
    router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
  };
}
