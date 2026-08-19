import type { Metadata } from "next";

import { requireUser } from "@/features/auth/auth.session";

export const metadata: Metadata = { title: "Library · Marginalia" };

/**
 * Placeholder. Phase 4 fills this with the user's books.
 *
 * It calls `requireUser()` even though the parent layout already did, which is
 * not redundant: it is what makes the page's own guarantee independent of its
 * position in the route tree.
 */
export default async function LibraryPage() {
  const user = await requireUser();

  return (
    <main className="flex flex-col gap-4">
      <h1 className="font-serif text-3xl">Your library</h1>
      <p className="text-ink-muted">
        Signed in as {user.email}. Books arrive in phase 4.
      </p>
    </main>
  );
}
