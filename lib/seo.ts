import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

/** Search-facing copy, written for people looking for an AI work assistant. */
export const SEO = {
  title: `${BRAND.name}: AI work assistant for your inbox, calendar and tasks`,
  description: `${BRAND.name} is an AI work assistant that sorts your Gmail, drafts replies for you to review, plans your day from your calendar, and keeps tasks and notes in one calm place. Nothing is sent without your click.`,
  keywords: ["Cowork", "Cowork app", "AI work assistant", "AI email assistant", "Gmail AI assistant", "daily briefing", "inbox triage", "AI task manager", "personal assistant app", "MCP server for Claude"],
};

/** Metadata for a public, indexable page. */
export function publicPage(o: { title?: string; description?: string; path: string }): Metadata {
  const title = o.title ?? SEO.title;
  const description = o.description ?? SEO.description;
  return {
    title: o.title ? o.title : { absolute: SEO.title },
    description,
    alternates: { canonical: o.path },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
    openGraph: { type: "website", siteName: BRAND.name, title, description, url: o.path, locale: "en_US", images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${BRAND.name}: AI work assistant` }] },
    twitter: { card: "summary_large_image", title, description, images: ["/opengraph-image"] },
  };
}
