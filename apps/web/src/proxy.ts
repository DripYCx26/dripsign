import { NextResponse } from 'next/server';
import { contentSecurityPolicy } from './framing';

/**
 * Staff pages and the bridge entry may be framed by the configured host app and nobody else.
 * The image is generic, so the host origin is read per request instead of at build time;
 * next.config.ts leaves X-Frame-Options off these paths so this policy alone decides.
 */
export function proxy(): NextResponse {
  const response = NextResponse.next();
  const host = process.env.DRIPSIGN_BRIDGE_HOST_ORIGIN;
  if (host) response.headers.set('Content-Security-Policy', contentSecurityPolicy(host));
  return response;
}

export const config = { matcher: ['/staff', '/staff/:path*', '/api/bridge/session'] };
