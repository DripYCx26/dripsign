import 'server-only';
import { createHash, createHmac } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import type { Actor, AuthSession } from '@dripsign/db';
import { getConfiguration } from './config';
import { getStore } from './store';
import { HttpError } from './http';

export const SESSION_COOKIE = 'dripsign_session';
export const CHALLENGE_COOKIE = 'dripsign_challenge';
export const SESSION_SECONDS = 24 * 60 * 60;
/** A staff session a host app opened inside its own page; partitioned to that page's site. */
export const BRIDGE_SESSION_COOKIE = 'dripsign_bridge_session';
// ASSUMPTION: a host's staff session lasts at most a working day; DripSign rechecks membership on
// every request, so this bounds only how long a partitioned cookie can outlive the host page.
export const BRIDGE_SESSION_SECONDS = 12 * 60 * 60;
export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function hashCode(challengeId: string, code: string): string {
  return createHmac('sha256', getConfiguration().authSecret).update(`${challengeId}:${code}`).digest('hex');
}

type NativeSession = { readonly session: AuthSession; readonly tokenHash: string; readonly isBridged: boolean };

/** The browser's own session first, then one a host opened; each is checked in the store. */
async function readSession(kind?: Actor['kind']): Promise<NativeSession | null> {
  const jar = await cookies();
  for (const [name, isBridged] of [[SESSION_COOKIE, false], [BRIDGE_SESSION_COOKIE, true]] as const) {
    const token = jar.get(name)?.value;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) continue;
    const tokenHash = hashToken(token);
    const session = await getStore().findSession(tokenHash);
    if (session && (!kind || session.actor.kind === kind)) return { session, tokenHash, isBridged };
  }
  return null;
}

/** Signing passes the current cookie's hash so the store can recheck the session transactionally. */
export async function requireSession(kind?: Actor['kind']): Promise<NativeSession> {
  const session = await readSession(kind);
  if (!session) throw new HttpError(401, 'authentication_required');
  return session;
}

/** A native session identifies its actor; the store checks live resource grants separately. */
export async function readActor(kind?: Actor['kind']): Promise<AuthSession['actor'] | null> {
  return (await readSession(kind))?.session.actor ?? null;
}

/** A staff page inside a host app hides the browser's own sign-in and sign-out. */
export async function readStaffEntry(): Promise<{ readonly actor: AuthSession['actor'] | null; readonly isEmbedded: boolean }> {
  const session = await readSession('staff');
  const isFramed = (await headers()).get('sec-fetch-dest') === 'iframe';
  return { actor: session?.session.actor ?? null, isEmbedded: isFramed || Boolean(session?.isBridged) };
}

export async function requireActor(kind?: Actor['kind']): Promise<AuthSession['actor']> {
  const actor = await readActor(kind);
  if (!actor) throw new HttpError(401, 'authentication_required');
  return actor;
}

/** Sent only inside the host page that opened it: cross-site, so None, and Partitioned (CHIPS). */
export function bridgeCookieSettings(): { httpOnly: true; secure: true; sameSite: 'none'; partitioned: true; path: string; maxAge: number } {
  return { httpOnly: true, secure: true, sameSite: 'none', partitioned: true, path: '/', maxAge: BRIDGE_SESSION_SECONDS };
}

export function cookieSettings(maxAge: number): { httpOnly: true; secure: boolean; sameSite: 'strict'; path: string; maxAge: number } {
  return { httpOnly: true, secure: new URL(getConfiguration().publicOrigin).protocol === 'https:', sameSite: 'strict', path: '/', maxAge };
}
