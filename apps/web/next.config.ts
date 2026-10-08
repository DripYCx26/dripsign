import type { NextConfig } from 'next';
import { contentSecurityPolicy } from './src/framing';

// The inline PDF sets its own sandboxed policy and frame parents; a header here would replace it.
const INLINE_PDF = 'api/agreements/[^/]+/pdf$';

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@dripsign/db', '@dripsign/core', '@dripsign/ui'],
  async headers() {
    return [
      { source: '/:path*', headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ] },
      { source: `/:path((?!${INLINE_PDF}).*)`, headers: [
        { key: 'Content-Security-Policy', value: contentSecurityPolicy("'none'") },
      ] },
      // Pages a host app may frame take their policy from src/proxy.ts; elsewhere the legacy
      // header backs up frame-ancestors 'none'.
      { source: `/:path((?!staff(?:/|$)|api/bridge/session$|${INLINE_PDF}).*)`, headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
      ] },
    ];
  },
};

export default config;
