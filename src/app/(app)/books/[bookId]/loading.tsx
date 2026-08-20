import { Skeleton } from "@/components/ui/skeleton";

export default function BookLoading() {
  return (
    <main className="flex flex-col gap-6">
      <Skeleton className="h-3 w-56" />

      <div className="flex flex-col gap-2 border-b border-rule pb-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-72" />
      </div>

      <Skeleton className="h-24 w-full" />

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
          <li key={index} className="flex flex-col gap-2">
            <Skeleton className="aspect-[3/4] w-full" />
            <Skeleton className="h-3 w-16" />
          </li>
        ))}
      </ul>
    </main>
  );
}
