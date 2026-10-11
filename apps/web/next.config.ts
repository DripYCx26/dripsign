import type { NextConfig } from "next";

// Static headers for every response, route handlers and assets included. The per-request CSP
// with its nonce comes from src/proxy.ts; PDF responses add their own sandbox policy.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

// Server action bodies keep Next's documented 1 MB default: `experimental.serverActions` would
// only restate it and add an experiments banner to every build.
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
  // Core ships TypeScript source with `.ts` import specifiers; Next compiles it in place.
  transpilePackages: ["@dripsign/core"],
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: SECURITY_HEADERS }]);
  },
};

export default config;
