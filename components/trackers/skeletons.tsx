import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";

/** Loading shape shared by both tracker tabs: a summary row and a list card. */
export function TrackerSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <Skeleton className="h-11 w-full rounded-[10px]" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-8 w-40" />
        </Card>
        <Card className="p-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-8 w-40" />
        </Card>
      </div>
      <Card className="flex flex-col gap-3 p-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </Card>
    </div>
  );
}
