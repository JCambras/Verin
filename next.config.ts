import type { NextConfig } from "next";

/**
 * Verin Next.js configuration.
 *
 * Security headers are declared here so every response carries them regardless
 * of deploy target (charter non-negotiable #14/#15; avoids the "half-Heroku,
 * half-Vercel" header drift the retro flagged). The house-CRM store (PGlite in
 * dev/CI, managed Postgres in prod) is a server-only native module, so it is
 * marked external and every route that touches it runs on the Node runtime.
 */
// No Content-Security-Policy YET: a real one needs a per-request nonce strategy
// (deliberate work), and a decorative unsafe-inline policy would be theater —
// recorded deferral ADR-0021 / D-020, trigger = before the first real deployment.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
