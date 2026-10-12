import "server-only";
import { cookies } from "next/headers";
import { themeSchema, type Theme } from "@dripsign/core/schema";

/** The browser's choice of theme; absent means follow the device. Set by `setTheme`. */
export const THEME_COOKIE = "dripsign-theme";

/** The saved theme, or `undefined` for the device's. A stale or forged value reads as unset. */
export async function readTheme(): Promise<Theme | undefined> {
  const parsed = themeSchema.safeParse((await cookies()).get(THEME_COOKIE)?.value);
  return parsed.success ? parsed.data : undefined;
}
