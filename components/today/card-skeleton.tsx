import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";

export function CardSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <Card className={className} aria-busy="true" aria-label="Loading">
      <div className="px-5 pt-5 pb-3">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex flex-col gap-3 px-5 pb-5">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </Card>
  );
}

export function RibbonSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading news" className="flex gap-2 overflow-hidden pt-[26px]">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-[72px] w-[288px] shrink-0 rounded-[12px]" />
      ))}
    </div>
  );
}
