import 'server-only';
import { createHash, createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Actor, AuthSession } from '@dripsign/db';
import { getConfiguration } from './config';
import { getStore } from './store';
import { HttpError } from './http';

export const SESSION_COOKIE = 'dripsign_session';
export const CHALLENGE_COOKIE = 'dripsign_challenge';
export const SESSION_SECONDS = 24 * 60 * 60;
export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function hashCode(challengeId: string, code: string): string {
  return createHmac('sha256', getConfiguration().authSecret).update(`${challengeId}:${code}`).digest('hex');
}

type NativeSession = { readonly session: AuthSession; readonly tokenHash: string };

async function readSession(kind?: Actor['kind']): Promise<NativeSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = hashToken(token);
  const session = await getStore().findSession(tokenHash);
  if (!session || (kind && session.actor.kind !== kind)) return null;
  return { session, tokenHash };
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

export async function requireActor(kind?: Actor['kind']): Promise<AuthSession['actor']> {
  const actor = await readActor(kind);
  if (!actor) throw new HttpError(401, 'authentication_required');
  return actor;
}

export function cookieSettings(maxAge: number): { httpOnly: true; secure: boolean; sameSite: 'strict'; path: string; maxAge: number } {
  return { httpOnly: true, secure: new URL(getConfiguration().publicOrigin).protocol === 'https:', sameSite: 'strict', path: '/', maxAge };
}
