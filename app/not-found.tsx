import type { Metadata } from "next";
import { StatusPage } from "@/components/layout/status-page";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  return <StatusPage title="This page doesn't exist" message="The link may be old or mistyped, or the page has moved." action={{ href: "/", label: "Go to Cowork" }} />;
}
