import { KnowledgeTabs } from "@/components/knowledge/knowledge-tabs";
import { PageHeader } from "@/components/ui/states";

export default function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Knowledge" description="What your agent knows. Answers cite these sources, and say so when something isn't here." />
      <KnowledgeTabs />
      {children}
    </>
  );
}
