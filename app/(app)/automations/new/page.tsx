import type { Metadata } from "next";
import { AutomationBuilder } from "@/components/automations/builder";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { TEMPLATES } from "@/lib/automations/templates";

export const metadata: Metadata = { title: "New automation" };
export const dynamic = "force-dynamic";

export default async function NewAutomationPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  await requireOwner();
  const { template } = await searchParams;
  const t = TEMPLATES.find((x) => x.id === template);
  return (
    <>
      <PageHeader title={t ? t.name : "New automation"} description={t?.description ?? "Pick a trigger, add conditions if you like, then the actions to take."} />
      <AutomationBuilder
        initial={{
          name: t?.name ?? "",
          description: t?.description ?? "",
          template: t?.id,
          trigger: t?.trigger ?? { type: "schedule", cron: "0 9 * * 1-5", text: "every weekday at 9am" },
          conditions: t?.conditions ?? [],
          actions: t?.actions ?? [{ type: "notify", title: "" }],
          permissions: [...new Set((t?.actions ?? [{ type: "notify" }]).map((a) => a.type))],
          timeoutMs: 60_000,
          enabled: true,
        }}
      />
    </>
  );
}
