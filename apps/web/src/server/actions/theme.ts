"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { loadConfig } from "@dripsign/core/config";
import { themeSchema } from "@dripsign/core/schema";
import { THEME_COOKIE } from "@/features/shell/theme.ts";
import { action } from "../action.ts";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** `system` forgets the choice, so the device decides again. */
const themeInput = z.strictObject({ theme: z.union([themeSchema, z.literal("system")]) });

/**
 * Saves the theme in a cookie the root layout reads on every request, so the first paint is
 * already themed. A personal setting of this browser: it needs no session and holds no data.
 */
export const setTheme = action(themeInput, async ({ theme }) => {
  const jar = await cookies();
  if (theme === "system") {
    jar.delete(THEME_COOKIE);
    return null;
  }
  jar.set({
    name: THEME_COOKIE,
    value: theme,
    httpOnly: true,
    secure: loadConfig().publicOrigin.startsWith("https:"),
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return null;
});
