"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/features/auth/auth.session";

import { storeBookCover } from "./books.cover";
import { createBook, setBookCoverStorageKey } from "./books.repository";
import {
  addBookInputSchema,
  deleteBookSchema,
  type AddBookState,
} from "./books.schema";
import { deleteBookAndObjects } from "./books.service";

/**
 * Add a book to the signed-in user's library.
 *
 * `requireUser()` is called here, inside the Server Function, and not merely
 * relied upon from the page's layout. A Server Function is a POST to whichever
 * route rendered it, so its protection has to be its own — see DECISIONS 0016.
 */
export async function addBookAction(
  _previous: AddBookState,
  formData: FormData,
): Promise<AddBookState> {
  const user = await requireUser();

  const parsed = addBookInputSchema.safeParse({
    title: formData.get("title"),
    author: formData.get("author") || undefined,
    // Empty hidden inputs arrive as "", which is not a URL and not null.
    coverUrl: formData.get("coverUrl") || null,
    openLibraryId: formData.get("openLibraryId") || null,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Could not add that book.",
      addedTitle: null,
    };
  }

  const book = await createBook(user.id, {
    title: parsed.data.title,
    author: parsed.data.author,
    coverUrl: parsed.data.coverUrl,
    openLibraryId: parsed.data.openLibraryId,
    // Open Library's search does not reliably expose series information, so
    // these stay null until there is a way to set them that is worth trusting.
    series: null,
    seriesIndex: null,
  });

  // Keep our own copy of the cover. Open Library's CDN takes seconds to answer,
  // which turns a library page into a wall of alt text; fetching it once here
  // means every later render serves it from the bucket we already use.
  //
  // Deliberately after the insert and tolerant of failure: the book is saved
  // either way, and `coverUrl` still works as a fallback.
  if (parsed.data.coverUrl) {
    const coverStorageKey = await storeBookCover(
      user.id,
      book.id,
      parsed.data.coverUrl,
    );

    if (coverStorageKey) {
      await setBookCoverStorageKey(user.id, book.id, coverStorageKey);
    }
  }

  // The library list is a different route, so it has its own cache entry.
  revalidatePath("/library");

  return { error: null, addedTitle: parsed.data.title };
}

export async function deleteBookAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = deleteBookSchema.safeParse({ bookId: formData.get("bookId") });

  if (!parsed.success) redirect("/library");

  const result = await deleteBookAndObjects(user.id, parsed.data.bookId);
  revalidatePath("/library");

  redirect(
    result.status === "deleted" && result.cleanupIncomplete
      ? "/library?cleanup=needed"
      : "/library",
  );
}
