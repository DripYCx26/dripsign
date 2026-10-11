"use server";

import { headers } from "next/headers";
import { z } from "zod";
import * as sessions from "@dripsign/core/auth/sessions";
import { loadConfig } from "@dripsign/core/config";
import { DomainError, notFound } from "@dripsign/core/errors";
import { emailSchema, uuidSchema } from "@dripsign/core/schema";
import type { SessionView } from "@dripsign/core/types";
import { action } from "../action.ts";
import { clearCookie, readCookie, writeCookie } from "../cookies.ts";
import { clientIp, isLoopbackRequest } from "../http.ts";
import { actionSession } from "../session.ts";

const codeInput = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/u, "Enter the 6-digit code."),
});

/** Same answer for every address; the challenge cookie binds the code to this browser. */
export const requestCode = action(z.strictObject({ email: emailSchema }), async ({ email }) => {
  const challenge = await sessions.requestCode(email, await requestIp());
  await writeCookie("challenge", challenge.challengeToken, new Date(challenge.expiresAt));
  return { expiresAt: challenge.expiresAt };
});

export const verifyCode = action(codeInput, async ({ code }) => {
  const issued = await sessions.verifyCode(await challengeToken(), code, await requestIp());
  await clearCookie("challenge");
  return startSession(issued);
});

export const signOut = action(z.void(), async () => {
  for (const kind of ["session", "embed"] as const) {
    const token = await readCookie(kind);
    if (token === null) continue;
    await sessions.signOut(token);
    await clearCookie(kind);
  }
  return null;
});

export const selectTenant = action(
  z.strictObject({ tenantId: uuidSchema }),
  async ({ tenantId }) => {
    const current = await actionSession();
    await sessions.selectTenant(current.resolved.session, tenantId);
    return viewOf(current.token);
  },
);

/** Development only; anywhere else it answers exactly like an unknown action target. */
export const devSignIn = action(z.strictObject({ email: emailSchema }), async ({ email }) => {
  if (!loadConfig().devLogin || !isLoopbackRequest(await headers())) throw notFound();
  return startSession(await sessions.devSignIn(email));
});

/** Re-verification before signing: a code bound to the current session, never a sign-out. */
export const stepUpRequest = action(z.void(), async () => {
  const current = await actionSession();
  const challenge = await sessions.requestCode(
    current.resolved.session.email,
    await requestIp(),
    current.token,
  );
  await writeCookie("challenge", challenge.challengeToken, new Date(challenge.expiresAt));
  return { expiresAt: challenge.expiresAt };
});

export const stepUpVerify = action(codeInput, async ({ code }) => {
  const current = await actionSession();
  const issued = await sessions.verifyCode(
    await challengeToken(),
    code,
    await requestIp(),
    current.token,
  );
  await clearCookie("challenge");
  await writeCookie(current.cookie, issued.sessionToken, new Date(issued.expiresAt));
  return viewOf(issued.sessionToken);
});

async function startSession(issued: sessions.IssuedSession): Promise<SessionView> {
  const previous = await readCookie("session");
  if (previous !== null && previous !== issued.sessionToken) await sessions.signOut(previous);
  await writeCookie("session", issued.sessionToken, new Date(issued.expiresAt));
  return viewOf(issued.sessionToken);
}

// Read by token: the request's cookies still hold the value from before this action.
async function viewOf(sessionToken: string): Promise<SessionView> {
  const resolved = await sessions.readSession(sessionToken);
  if (resolved === null) throw new Error("A session just issued or updated is not readable");
  return resolved.view;
}

async function challengeToken(): Promise<string> {
  const token = await readCookie("challenge");
  if (token === null) throw new DomainError("invalid", "This code has expired. Request a new one.");
  return token;
}

async function requestIp(): Promise<string | null> {
  return clientIp(await headers());
}
