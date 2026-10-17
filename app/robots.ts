import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/env";

/** Crawl the public pages only; the signed-in app, OAuth and APIs stay out of search. */
export default function robots(): MetadataRoute.Robots {
  const base = appUrl();
  return {
    rules: [{ userAgent: "*", allow: ["/$", "/home", "/privacy", "/terms", "/login", "/opengraph-image"], disallow: ["/api/", "/oauth/", "/onboarding", "/settings", "/inbox", "/tasks", "/chat", "/knowledge", "/content", "/automations", "/integrations", "/flow"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
