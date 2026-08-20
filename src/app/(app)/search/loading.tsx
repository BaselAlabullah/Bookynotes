import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <div className="flex flex-col gap-3 border-b border-rule pb-5">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-9 w-80" />
      </div>
      <Skeleton className="h-11 w-full" />
      <div className="flex flex-col gap-5 border-t border-rule pt-5">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[11rem_1fr] sm:gap-8">
            <Skeleton className="h-4 w-32" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
