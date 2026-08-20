import { z } from "zod";
import { asBookId } from "@/db/ids";

export const deleteBookSchema = z.object({
  bookId: z.uuid().transform(asBookId),
});

/**
 * Validation for anything crossing into the books feature from outside.
 */

/**
 * A search query. The lower bound is not cosmetic: a one-character query makes
 * Open Library scan its whole index and return noise, slowly.
 */
export const bookSearchQuerySchema = z
  .string()
  .trim()
  .min(2, "Type at least two characters.")
  .max(120, "That query is too long.");

/**
 * The fields carried from a chosen search result into a new book row.
 *
 * These arrive as hidden form inputs, which means they are user input no matter
 * where the UI got them from. Nothing here is trusted because it "came from
 * Open Library" — it came from a form post.
 */
export const addBookInputSchema = z.object({
  title: z.string().trim().min(1, "A book needs a title.").max(500),
  /**
   * `books.author` is NOT NULL, but Open Library often has no author. Rather
   * than make the column nullable for a display concern, an absent author
   * becomes an explicit placeholder that reads correctly in a list.
   */
  author: z.string().trim().max(300).default("Unknown author"),
  coverUrl: z.url().max(500).nullable(),
  openLibraryId: z
    .string()
    .trim()
    // Open Library work ids look like OL20893680W. Constraining the shape stops
    // this column becoming a dumping ground for arbitrary strings.
    .regex(/^OL\d+W$/, "That is not an Open Library work id.")
    .nullable(),
});

export type AddBookInput = z.infer<typeof addBookInputSchema>;

/** What the add-book Server Function hands back to the form. */
export type AddBookState = {
  error: string | null;
  addedTitle: string | null;
};

export const emptyAddBookState: AddBookState = {
  error: null,
  addedTitle: null,
};

/**
 * The envelope this feature's route handler returns on failure. Declared next
 * to the endpoint it describes rather than in a shared bag of API types, so it
 * can change with the endpoint.
 */
export const apiErrorSchema = z.object({ error: z.string() });
