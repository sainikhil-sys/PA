import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  const updated = new Date("2026-10-17");
  return [
    { url: `${base}/home`, lastModified: updated, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/login`, lastModified: updated, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/privacy`, lastModified: updated, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, lastModified: updated, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/delete-account`, lastModified: new Date("2026-10-20"), changeFrequency: "yearly", priority: 0.2 },
  ];
}
