import { Skeleton } from "@/components/ui/skeleton";

/**
 * The page view's shell.
 *
 * Laid out to match the real thing — page on the left, margin notes on the
 * right — so that when the content arrives it lands where the placeholder
 * already was, instead of shoving the layout around.
 */
export default function PageViewLoading() {
  return (
    <main className="flex flex-col gap-5">
      <Skeleton className="h-3 w-72" />

      <div className="flex items-end justify-between gap-4 border-b border-rule pb-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-56" />
        </div>
        <Skeleton className="h-6 w-24" />
      </div>

      <div className="flex gap-2 overflow-hidden">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => (
          <Skeleton key={index} className="h-14 w-11 shrink-0" />
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <Skeleton className="aspect-[3/4] w-full" />
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex flex-col gap-2 border-b border-rule pb-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
