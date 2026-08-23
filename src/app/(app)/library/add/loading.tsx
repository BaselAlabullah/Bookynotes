import { Skeleton } from "@/components/ui/skeleton";

export default function AddBookLoading() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <Skeleton className="h-3 w-40" />

      <div className="flex flex-col gap-3 border-b border-rule pb-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-12 w-full" />
        </div>

        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-start gap-4 border-b border-rule pb-5">
              <Skeleton className="h-[138px] w-[92px] shrink-0" />
              <div className="flex flex-1 flex-col gap-2 pt-1">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-9 w-14" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
