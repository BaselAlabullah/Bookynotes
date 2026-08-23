import { beforeEach, describe, expect, it, vi } from "vitest";

import { asBookId, asPageId, asUserId } from "@/db/ids";

const findBook = vi.fn();
const deleteBook = vi.fn();
const listPagesForBook = vi.fn();
const removeObjects = vi.fn();
/** Records the order in which the two side effects happen. */
const calls: string[] = [];

vi.mock("./books.repository", () => ({
  findBook: (...args: unknown[]) => findBook(...args),
  deleteBook: (...args: unknown[]) => {
    calls.push("deleteBook");
    return deleteBook(...args);
  },
}));

vi.mock("@/features/pages/pages.repository", () => ({
  listPagesForBook: (...args: unknown[]) => {
    calls.push("listPagesForBook");
    return listPagesForBook(...args);
  },
  listPagesForBooks: vi.fn(),
}));

vi.mock("@/features/annotations/annotations.repository", () => ({
  countAnnotationsForPages: vi.fn(),
  countAnnotationStatusesForPages: vi.fn(),
}));

vi.mock("@/integrations/storage/storage.client", () => ({
  removeObjects: (...args: unknown[]) => {
    calls.push("removeObjects");
    return removeObjects(...args);
  },
}));

const { deleteBookAndObjects } = await import("./books.service");

const USER = asUserId("11111111-1111-1111-1111-111111111111");
const BOOK = asBookId("22222222-2222-2222-2222-222222222222");

const page = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: asPageId(`3333333${n}-3333-3333-3333-333333333333`),
  bookId: BOOK,
  storageKey: `${USER}/${BOOK}/page-${n}.jpg`,
  thumbnailStorageKey: `${USER}/${BOOK}/page-${n}.thumb.jpg`,
  originalStorageKey: `${USER}/${BOOK}/page-${n}.orig.jpg`,
  ...overrides,
});

/**
 * Deleting a book deletes its pages and their annotations through database
 * cascades, but nothing cascades into the storage bucket. The keys therefore
 * have to be gathered from rows that are about to stop existing, and the order
 * of the two systems is the whole correctness argument — see DECISIONS 0081.
 */
describe("deleteBookAndObjects", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
    findBook.mockResolvedValue({
      id: BOOK,
      coverStorageKey: `${USER}/covers/${BOOK}.jpg`,
    });
    deleteBook.mockResolvedValue(true);
    listPagesForBook.mockResolvedValue([page(1), page(2)]);
    removeObjects.mockResolvedValue(undefined);
  });

  it("collects every descendant key the cascade is about to orphan", async () => {
    await deleteBookAndObjects(USER, BOOK);

    expect(removeObjects).toHaveBeenCalledTimes(1);
    expect(new Set(removeObjects.mock.calls[0]![0] as string[])).toEqual(
      new Set([
        `${USER}/covers/${BOOK}.jpg`,
        `${USER}/${BOOK}/page-1.jpg`,
        `${USER}/${BOOK}/page-1.thumb.jpg`,
        `${USER}/${BOOK}/page-1.orig.jpg`,
        `${USER}/${BOOK}/page-2.jpg`,
        `${USER}/${BOOK}/page-2.thumb.jpg`,
        `${USER}/${BOOK}/page-2.orig.jpg`,
      ]),
    );
  });

  it("reads the pages before the row is deleted, not after", async () => {
    // Listing after the cascade would return nothing and silently orphan
    // every object belonging to the book.
    await deleteBookAndObjects(USER, BOOK);

    expect(calls.indexOf("listPagesForBook")).toBeLessThan(
      calls.indexOf("deleteBook"),
    );
  });

  it("deletes the row before the objects", async () => {
    // The reverse order leaves a page whose image 404s if the row delete then
    // fails. An orphaned object is invisible and sweepable; a row pointing at
    // nothing is a broken page.
    await deleteBookAndObjects(USER, BOOK);

    expect(calls.indexOf("deleteBook")).toBeLessThan(
      calls.indexOf("removeObjects"),
    );
  });

  it("omits keys that are null rather than passing them through", async () => {
    findBook.mockResolvedValue({ id: BOOK, coverStorageKey: null });
    listPagesForBook.mockResolvedValue([
      page(1, { thumbnailStorageKey: null, originalStorageKey: null }),
    ]);

    await deleteBookAndObjects(USER, BOOK);

    expect(removeObjects.mock.calls[0]![0]).toEqual([
      `${USER}/${BOOK}/page-1.jpg`,
    ]);
  });

  it("reports the row gone but the bucket dirty when cleanup fails", async () => {
    // The book really is deleted. Saying otherwise would invite a retry that
    // cannot succeed, so the leftover objects are surfaced instead.
    removeObjects.mockRejectedValue(new Error("storage unreachable"));

    await expect(deleteBookAndObjects(USER, BOOK)).resolves.toEqual({
      status: "deleted",
      cleanupIncomplete: true,
    });
  });

  it("touches no objects when the book is not this user's", async () => {
    findBook.mockResolvedValue(null);

    await expect(deleteBookAndObjects(USER, BOOK)).resolves.toEqual({
      status: "not-found",
    });
    expect(deleteBook).not.toHaveBeenCalled();
    expect(removeObjects).not.toHaveBeenCalled();
  });

  it("touches no objects when the row vanished between read and delete", async () => {
    deleteBook.mockResolvedValue(false);

    await expect(deleteBookAndObjects(USER, BOOK)).resolves.toEqual({
      status: "not-found",
    });
    expect(removeObjects).not.toHaveBeenCalled();
  });
});
