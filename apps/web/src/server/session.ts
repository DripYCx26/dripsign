import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound as renderNotFound, redirect } from "next/navigation";
import {
  readRequestSession,
  resolveRecipient,
  resolveStaff,
  type RequestSession,
} from "@dripsign/core/auth/sessions";
import { loadConfig } from "@dripsign/core/config";
import { isDomainError, notFound } from "@dripsign/core/errors";
import type {
  Actor,
  Capacity,
  RecipientActor,
  RequestEvidence,
  SessionView,
  StaffActor,
} from "@dripsign/core/types";
import { readCookie } from "./cookies.ts";
import { requestEvidence } from "./request.ts";
import { PATH_HEADER, safeNextPath, signInPath } from "./navigation.ts";

export interface StaffContext {
  readonly actor: StaffActor;
  readonly session: SessionView;
}

export interface RecipientContext {
  readonly actor: RecipientActor;
  readonly session: SessionView;
}

/**
 * The live session for this request; `readRequestSession` owns which cookie wins. Deduplicated
 * per render; roles are never read from it, only the email.
 */
export const currentSession = cache(async (): Promise<RequestSession | null> =>
  readRequestSession({ embed: await readCookie("embed"), session: await readCookie("session") }),
);

export async function getSession(): Promise<SessionView | null> {
  return (await currentSession())?.resolved.view ?? null;
}

/** Pages under /staff: signed out goes to sign-in and back; no live staff row renders not-found. */
export async function requireStaff(): Promise<StaffContext> {
  const current = await currentSession();
  if (current === null) return redirect(await signInRedirect());
  const actor = await orNotFound(staffActorIn(current));
  return { actor, session: current.resolved.view };
}

/**
 * Recipient pages: a missing, malformed, revoked or unpublished agreement all render the same
 * not-found page, so the response never says whether the agreement exists.
 */
export async function requireRecipient(agreementId: string): Promise<RecipientContext> {
  const current = await currentSession();
  if (current === null) return redirect(await signInRedirect());
  const actor = await orNotFound(recipientActorIn(current, agreementId));
  return { actor, session: current.resolved.view };
}

/** Server actions: a signed-out caller is sent to sign-in and back to the page it acted on. */
export async function actionSession(): Promise<RequestSession> {
  const current = await currentSession();
  if (current === null) return redirect(await signInRedirect());
  return current;
}

/**
 * The actor for a capacity, resolved live and carrying this request's evidence (recorded on a
 * signature); anything short of standing is `not_found`.
 */
export async function actorIn(
  current: RequestSession | null,
  capacity: Capacity,
  agreementId: string,
): Promise<Actor> {
  return capacity === "staff" ? staffActorIn(current) : recipientActorIn(current, agreementId);
}

export async function staffActorIn(current: RequestSession | null): Promise<StaffActor> {
  if (current === null) throw notFound();
  const actor = await resolveStaff(current.resolved.session);
  return { ...actor, request: await evidence() };
}

async function recipientActorIn(
  current: RequestSession | null,
  agreementId: string,
): Promise<RecipientActor> {
  if (current === null) throw notFound();
  const actor = await resolveRecipient(current.resolved.session, agreementId);
  return { ...actor, request: await evidence() };
}

export async function staffActor(): Promise<StaffActor> {
  return staffActorIn(await actionSession());
}

export async function actorFor(capacity: Capacity, agreementId: string): Promise<Actor> {
  return actorIn(await actionSession(), capacity, agreementId);
}

async function evidence(): Promise<RequestEvidence> {
  return requestEvidence(await headers(), loadConfig().trustedProxyHops);
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
