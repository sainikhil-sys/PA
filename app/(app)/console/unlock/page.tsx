import { redirect } from "next/navigation";
import { StepUp } from "@/components/admin/step-up";
import { getAdminSession } from "@/lib/admin/admin-session";
import { requireAdminRole } from "@/lib/admin/guard";
import { getMfaStatus } from "@/lib/admin/mfa";

export default async function ConsoleUnlock() {
  const user = await requireAdminRole();
  if (await getAdminSession()) redirect("/console");
  const mfa = await getMfaStatus(user.id);
  return <StepUp enrolled={mfa.enrolled} lockedUntil={mfa.lockedUntil?.toISOString() ?? null} />;
}
