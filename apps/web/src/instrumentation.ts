import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * Parses the configuration once before the server takes traffic, so an invalid environment (for
 * example development sign-in in production) stops boot instead of failing the first request.
 * Skipped while `next build` prerenders: the build has no runtime environment.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;
  const { loadConfig } = await import("@dripsign/core/config");
  loadConfig();
}
