import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Newsreader } from "next/font/google";
import { cookies } from "next/headers";
import { Toaster } from "sonner";
import { BRAND } from "@/lib/brand";
import { appUrl } from "@/lib/env";
import { SEO } from "@/lib/seo";
import "./globals.css";

// Two weights for UI text (400/500) and one for editorial headings — the "max two weights" rule.
const hanken = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-hanken", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], weight: ["400"], style: ["normal", "italic"], variable: "--font-newsreader", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  applicationName: BRAND.name,
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: SEO.description,
  keywords: SEO.keywords,
  authors: [{ name: BRAND.name }],
  creator: BRAND.name,
  // Private by default: the signed-in app never appears in search. Public pages opt in via publicPage().
  robots: { index: false, follow: false },
  formatDetection: { email: false, telephone: false, address: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f11" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The app's Reduce motion setting, mirrored in a cookie so it applies from first paint.
  const jar = await cookies();
  const reduceMotion = jar.get("pa_rm")?.value === "1";
  // Appearance: "light" or "dark" pins the theme; no cookie follows the system (globals.css).
  const themeCookie = jar.get("pa_theme")?.value;
  const theme = themeCookie === "light" || themeCookie === "dark" ? themeCookie : undefined;
  return (
    <html lang="en" data-theme={theme} data-reduce-motion={reduceMotion ? "true" : undefined} className={`${hanken.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
          Skip to content
        </a>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: "!rounded-[12px] !border !border-border !bg-background !text-foreground !shadow-pop !font-sans",
              description: "!text-muted",
              actionButton: "!bg-primary !text-primary-foreground",
            },
          }}
        />
      </body>
    </html>
  );
}
