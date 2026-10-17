import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Newsreader } from "next/font/google";
import { headers } from "next/headers";
import { Toaster } from "sonner";
import { INTRO_BOOT_SCRIPT, LaunchIntro } from "@/components/layout/launch-intro";
import { BRAND } from "@/lib/brand";
import "./globals.css";

// Two weights for UI text (400/500) and one for editorial headings — the "max two weights" rule.
const hanken = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-hanken", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], weight: ["400"], style: ["normal", "italic"], variable: "--font-newsreader", display: "swap" });

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: BRAND.tagline,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" data-theme="light" className={`${hanken.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        {/* Decides before first paint whether the launch intro plays (no flash). */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: INTRO_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <LaunchIntro />
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
