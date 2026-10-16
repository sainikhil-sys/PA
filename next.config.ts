import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Prompts are read from disk at runtime; make sure Vercel ships them.
  outputFileTracingIncludes: { "/**": ["./lib/ai/prompts/*.md"] },
  serverExternalPackages: ["googleapis", "@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Page CSP (with nonce) is set in middleware; API responses get a locked-down default.
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }] },
    ];
  },
  async rewrites() {
    return [
      // OAuth discovery documents for Claude's custom connector (RFC 8414 / RFC 9728).
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/protected-resource" },
    ];
  },
};

export default nextConfig;
