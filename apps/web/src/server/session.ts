import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound as renderNotFound, redirect } from "next/navigation";
import {
  readSession,
  resolveRecipient,
  resolveStaff,
  type ResolvedSession,
} from "@dripsign/core/auth/sessions";
import { isDomainError, notFound } from "@dripsign/core/errors";
import { uuidSchema } from "@dripsign/core/schema";
import type {
  Actor,
  Capacity,
  RecipientActor,
  SessionView,
  StaffActor,
} from "@dripsign/core/types";
import { readCookie } from "./cookies.ts";
import { PATH_HEADER, safeNextPath, signInPath } from "./navigation.ts";

export interface StaffContext {
  readonly actor: StaffActor;
  readonly session: SessionView;
}

export interface RecipientContext {
  readonly actor: RecipientActor;
  readonly session: SessionView;
}

export interface CurrentSession {
  readonly token: string;
  readonly cookie: "session" | "embed";
  readonly resolved: ResolvedSession;
}

/**
 * The live session for this request: the first-party cookie, else the bridge cookie (the only one
 * a host frame sends). Deduplicated per render; roles are never read from it, only the email.
 */
export const currentSession = cache(async (): Promise<CurrentSession | null> => {
  for (const cookie of ["session", "embed"] as const) {
    const token = await readCookie(cookie);
    if (token === null) continue;
    const resolved = await readSession(token);
    if (resolved !== null) return { token, cookie, resolved };
  }
  return null;
});

export async function getSession(): Promise<SessionView | null> {
  return (await currentSession())?.resolved.view ?? null;
}

/** Pages under /staff: signed out goes to sign-in and back; no live staff row renders not-found. */
export async function requireStaff(): Promise<StaffContext> {
  const current = await currentSession();
  if (current === null) return redirect(await signInRedirect());
  const actor = await orNotFound(resolveStaff(current.resolved.session));
  return { actor, session: current.resolved.view };
}

/**
 * Recipient pages: a missing, malformed, revoked or unpublished agreement all render the same
 * not-found page, so the response never says whether the agreement exists.
 */
export async function requireRecipient(agreementId: string): Promise<RecipientContext> {
  const current = await currentSession();
  if (current === null) return redirect(await signInRedirect());
  if (!uuidSchema.safeParse(agreementId).success) return renderNotFound();
  const actor = await orNotFound(resolveRecipient(current.resolved.session, agreementId));
  return { actor, session: current.resolved.view };
}

/** Server actions: a signed-out caller is sent to sign-in and back to the page it acted on. */
export async function actionSession(): Promise<CurrentSession> {
  const current = await currentSession();
  if (current === null) return redirect(await signInRedirect());
  return current;
}

/** The actor for a capacity, resolved live; anything short of standing is `not_found`. */
export async function actorIn(
  current: CurrentSession | null,
  capacity: Capacity,
  agreementId: string,
): Promise<Actor> {
  if (capacity === "staff") return staffActorIn(current);
  if (current === null) throw notFound();
  return resolveRecipient(current.resolved.session, agreementId);
}

export async function staffActorIn(current: CurrentSession | null): Promise<StaffActor> {
  if (current === null) throw notFound();
  return resolveStaff(current.resolved.session);
}

export async function staffActor(): Promise<StaffActor> {
  return staffActorIn(await actionSession());
}

export async function actorFor(capacity: Capacity, agreementId: string): Promise<Actor> {
  return actorIn(await actionSession(), capacity, agreementId);
}

async function orNotFound<T>(resolution: Promise<T>): Promise<T> {
  try {
    return await resolution;
  } catch (error) {
    if (isDomainError(error) && error.code === "not_found") renderNotFound();
    throw error;
  }
}

async function signInRedirect(): Promise<string> {
  return signInPath(safeNextPath((await headers()).get(PATH_HEADER)));
}
