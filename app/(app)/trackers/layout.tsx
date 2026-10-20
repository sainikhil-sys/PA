import { TrackersNav } from "@/components/trackers/trackers-nav";
import { PageHeader } from "@/components/ui/states";

export default function TrackersLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Trackers" description="Where your money goes and what you're learning." />
      <TrackersNav />
      {children}
    </>
  );
}
