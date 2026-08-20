"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/features/auth/auth.session";

import { createBook } from "./books.repository";
import {
  addBookInputSchema,
  type AddBookState,
} from "./books.schema";

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

  await createBook(user.id, {
    title: parsed.data.title,
    author: parsed.data.author,
    coverUrl: parsed.data.coverUrl,
    openLibraryId: parsed.data.openLibraryId,
    // Open Library's search does not reliably expose series information, so
    // these stay null until there is a way to set them that is worth trusting.
    series: null,
    seriesIndex: null,
  });

  // The library list is a different route, so it has its own cache entry.
  revalidatePath("/library");

  return { error: null, addedTitle: parsed.data.title };
}
