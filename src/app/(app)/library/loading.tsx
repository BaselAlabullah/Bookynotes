import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown the instant a navigation to the library starts.
 *
 * Every protected route is dynamically rendered — it has to be, the content is
 * one person's library — so the server cannot answer before it has asked
 * Supabase who is calling and what they own. A `loading` file lets Next send
 * the shell immediately and stream the rest in, which is the difference between
 * a page that feels instant and one that feels broken for half a second.
 */
export default function LibraryLoading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <div className="flex flex-col gap-3 border-b border-rule pb-5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-9 w-64" />
      </div>

      <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <li key={index} className="flex gap-4">
            <Skeleton className="h-[135px] w-[90px] shrink-0" />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
