import type { pages } from "@/db/schema";
import type { BookId } from "@/db/ids";

export type Page = typeof pages.$inferSelect;

export type NewPage = {
  bookId: BookId;
  pageNumber: number;
  /** Path inside the private bucket. Not a URL — signed URLs expire. */
  storageKey: string;
  /** Intrinsic dimensions of the uploaded image, in pixels. */
  imageWidth: number;
  imageHeight: number;
};
