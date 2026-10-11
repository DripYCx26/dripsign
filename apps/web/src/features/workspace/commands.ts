import type { CommandState } from "@/features/command/useCommand.ts";

/**
 * Sends one command through the workspace's single in-flight slot; the intent id names the user's
 * intent so a retry reuses its receipt key. Resolves true once the command applied. False leaves
 * the cause in `error` and the caller's input untouched.
 */
export type RunCommand = CommandState["run"];
