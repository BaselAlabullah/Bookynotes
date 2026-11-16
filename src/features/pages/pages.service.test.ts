import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asBookId, asPageId, asUserId } from "@/db/ids";
import type { PageCorners } from "./pages.schema";

const mocks = vi.hoisted(() => ({
  findBook: vi.fn(), findPage: vi.fn(), lockPage: vi.fn(), insertPage: vi.fn(),
  updatePageGeometry: vi.fn(), listAnnotationsForPage: vi.fn(), updateRegionAnnotationRects: vi.fn(),
  rectifyPage: vi.fn(), removeObjects: vi.fn(), removeObject: vi.fn(), uploadObject: vi.fn(),
  transaction: {},
}));
vi.mock("@/db/client", () => ({ db: { transaction: (run: (tx: unknown) => unknown) => run(mocks.transaction) } }));
vi.mock("@/features/books/books.repository", () => ({ findBook: mocks.findBook }));
vi.mock("./pages.repository", () => ({
  findPage: mocks.findPage, lockPage: mocks.lockPage, insertPage: mocks.insertPage,
  updatePageGeometry: mocks.updatePageGeometry, deletePage: vi.fn(),
}));
vi.mock("@/features/annotations/annotations.repository", () => ({
  listAnnotationsForPage: mocks.listAnnotationsForPage,
  updateRegionAnnotationRects: mocks.updateRegionAnnotationRects,
  countAnnotationStatusesForPages: vi.fn(),
}));
vi.mock("@/integrations/page-processor/page-processor.client", () => ({
  isPageProcessorConfigured: () => true, rectifyPage: mocks.rectifyPage,
}));
vi.mock("@/integrations/storage/storage.client", () => ({
  createSignedRead: async () => ({ url: "https://storage.example/image" }),
  createSignedUpload: vi.fn(), objectExists: async () => true,
  removeObject: mocks.removeObject, removeObjects: mocks.removeObjects, uploadObject: mocks.uploadObject,
}));
vi.mock("./pages.thumbnail", () => ({
  buildThumbnail: async () => Buffer.from("thumbnail"), thumbnailKeyFor: (key: string) => `${key}.thumb.jpg`,
}));
import { completeUpload, updatePageCorners } from "./pages.service";

const USER = asUserId("11111111-1111-4111-8111-111111111111");
const BOOK = asBookId("22222222-2222-4222-8222-222222222222");
const PAGE = asPageId("33333333-3333-4333-8333-333333333333");
const source = `${USER}/${BOOK}/44444444-4444-4444-8444-444444444444.jpg`;
const page = { id: PAGE, bookId: BOOK, storageKey: source, originalStorageKey: null, pageCorners: null, thumbnailStorageKey: "old-thumb.jpg" };
const corners: PageCorners = [{ x: .25, y: .25 }, { x: .75, y: .25 }, { x: .75, y: .75 }, { x: .25, y: .75 }];
const note = { id: "note", anchor: "region", rectX: .3, rectY: .3, rectWidth: .2, rectHeight: .1 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
  mocks.findBook.mockResolvedValue({ id: BOOK });
  mocks.findPage.mockResolvedValue(page);
  mocks.lockPage.mockResolvedValue(page);
  mocks.insertPage.mockImplementation(async (_user, input) => ({ ...input, id: PAGE }));
  mocks.updatePageGeometry.mockImplementation(async (_tx, _user, _id, input) => ({ ...page, ...input }));
  mocks.listAnnotationsForPage.mockResolvedValue([]);
  mocks.updateRegionAnnotationRects.mockResolvedValue(true);
  mocks.rectifyPage.mockResolvedValue({ rectified: true, width: 1000, height: 1400 });
  mocks.removeObject.mockResolvedValue(undefined);
  mocks.removeObjects.mockResolvedValue(undefined);
  mocks.uploadObject.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("upload straightening choice", () => {
  const upload = { bookId: BOOK, pageNumber: 1, storageKey: source, imageWidth: 1200, imageHeight: 1600 };

  it("keeps the uploaded image when straightening is disabled", async () => {
    const result = await completeUpload(USER, { ...upload, straighten: false });
    expect(result.status).toBe("created");
    expect(mocks.rectifyPage).not.toHaveBeenCalled();
    expect(mocks.insertPage).toHaveBeenCalledWith(USER, expect.objectContaining({ storageKey: source, originalStorageKey: null }));
    expect(mocks.uploadObject).toHaveBeenCalled(); // Thumbnails still work.
  });

  it("still supports manual corners and automatic detection", async () => {
    await completeUpload(USER, { ...upload, straighten: true, corners });
    expect(mocks.rectifyPage).toHaveBeenLastCalledWith(source, expect.any(String), corners);
    await completeUpload(USER, { ...upload, straighten: true });
    expect(mocks.rectifyPage).toHaveBeenLastCalledWith(source, expect.any(String), undefined);
  });

  it("retains the original upload when processing is unavailable", async () => {
    mocks.rectifyPage.mockResolvedValue(null);
    expect((await completeUpload(USER, { ...upload, straighten: true })).status).toBe("created");
    expect(mocks.insertPage).toHaveBeenCalledWith(USER, expect.objectContaining({ storageKey: source }));
  });
});

describe("corner-save consistency", () => {
  it("remaps notes created while image processing was running", async () => {
    mocks.listAnnotationsForPage.mockResolvedValueOnce([]).mockResolvedValueOnce([note]);
    const result = await updatePageCorners(USER, { pageId: PAGE, corners });
    expect(result.status).toBe("updated");
    expect(mocks.listAnnotationsForPage).toHaveBeenLastCalledWith(USER, PAGE, mocks.transaction);
    expect(mocks.lockPage.mock.invocationCallOrder[0]).toBeLessThan(mocks.listAnnotationsForPage.mock.invocationCallOrder[1]!);
    expect(mocks.updateRegionAnnotationRects).toHaveBeenCalledWith(mocks.transaction, USER, PAGE, [
      { annotationId: "note", rect: expect.objectContaining({ x: expect.closeTo(.098, 2), width: expect.closeTo(.402, 2) }) },
    ]);
    expect(mocks.removeObjects).toHaveBeenLastCalledWith(["old-thumb.jpg"]);
  });

  it("rejects a new out-of-crop note without committing geometry", async () => {
    mocks.listAnnotationsForPage.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...note, rectX: .2 }]);
    expect(await updatePageCorners(USER, { pageId: PAGE, corners })).toEqual({ status: "annotations-cannot-be-remapped" });
    expect(mocks.updatePageGeometry).not.toHaveBeenCalled();
    expect(mocks.removeObjects).toHaveBeenCalledWith([expect.stringContaining(".flat."), expect.stringContaining(".thumb.jpg")]);
    expect(mocks.removeObjects).not.toHaveBeenCalledWith(["old-thumb.jpg"]);
  });

  it("does not overwrite a crop saved by another request", async () => {
    mocks.lockPage.mockResolvedValue({ ...page, storageKey: "concurrent-crop.jpg" });
    expect(await updatePageCorners(USER, { pageId: PAGE, corners })).toEqual({ status: "page-changed" });
    expect(mocks.updatePageGeometry).not.toHaveBeenCalled();
    expect(mocks.updateRegionAnnotationRects).not.toHaveBeenCalled();
    expect(mocks.removeObjects).toHaveBeenCalledTimes(1);
  });

  it("refuses a partial clip before processing the image", async () => {
    mocks.listAnnotationsForPage.mockResolvedValue([{ ...note, rectX: .2 }]);
    expect(await updatePageCorners(USER, { pageId: PAGE, corners })).toEqual({ status: "annotations-cannot-be-remapped" });
    expect(mocks.rectifyPage).not.toHaveBeenCalled();
  });

  it("reports storage cleanup failure after a successful save", async () => {
    mocks.removeObjects.mockRejectedValue(new Error("Storage offline"));
    expect(await updatePageCorners(USER, { pageId: PAGE, corners })).toMatchObject({ status: "updated", cleanupIncomplete: true });
  });
});
