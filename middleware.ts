import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: sets a per-request CSP nonce and bounces requests without a
 * session cookie to /login. The cookie is fully validated (DB lookup + allowlist)
 * server-side in requireOwner(); this is only a fast first gate.
 */
const PUBLIC_PATHS = ["/login", "/home", "/privacy", "/terms", "/pair"];

function buildCsp(nonce: string, local: boolean): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Radix/Motion set inline style attributes; styles cannot execute code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    // Only the Today room's music and video players may be framed.
    "frame-src https://open.spotify.com https://www.youtube-nocookie.com",
    // Firebase Cloud Messaging registers devices through these Google endpoints.
    `connect-src 'self' https://fcmregistrations.googleapis.com https://firebaseinstallations.googleapis.com${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(dev || local ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasSession = req.cookies.has("__Host-pa_session") || req.cookies.has("pa_session");
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (pathname === "/" && !hasSession) {
    // Visitors and crawlers land on the public home page, not a sign-in wall.
    return NextResponse.redirect(new URL("/home", req.nextUrl.origin));
  }
  if (!isPublic && !hasSession) {
    const url = new URL("/login", req.nextUrl.origin);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const local = req.nextUrl.hostname === "localhost" || req.nextUrl.hostname === "127.0.0.1";
  const csp = buildCsp(nonce, local);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  matcher: [
    // Pages only. API routes and well-known documents authenticate themselves.
    "/((?!api/|_next/static|_next/image|brands/|downloads/|favicon.ico|icon.svg|sw.js|robots.txt|sitemap.xml|manifest.webmanifest|opengraph-image|\\.well-known).*)",
  ],
};
