import { SettingsNav } from "@/components/settings/settings-nav";
import { PageHeader } from "@/components/ui/states";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsNav />
      <div className="max-w-3xl">{children}</div>
    </>
  );
}
