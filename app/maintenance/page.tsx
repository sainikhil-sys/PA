import type { Metadata } from "next";
import { StatusPage } from "@/components/layout/status-page";
import { MAINTENANCE_MESSAGE } from "@/lib/maintenance";

export const metadata: Metadata = { title: "Back shortly", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Shown in place of every page while MAINTENANCE_MODE is on (see middleware.ts). */
export default function Maintenance() {
  return <StatusPage title="Back shortly" message={MAINTENANCE_MESSAGE} action={{ href: "/", label: "Try again" }} />;
}
