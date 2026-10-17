import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";
import { SEO } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: SEO.description,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/api/brand/logo?size=192", type: "image/png", sizes: "192x192" },
      { src: "/api/brand/logo?size=512", type: "image/png", sizes: "512x512" },
    ],
  };
}
