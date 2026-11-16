import { beforeEach, describe, expect, it, vi } from "vitest";
import { asPageId, asUserId } from "@/db/ids";

const mocks = vi.hoisted(() => ({ lockPage: vi.fn(), insertAnnotation: vi.fn(), transaction: {} }));
vi.mock("@/db/client", () => ({ db: { transaction: (run: (tx: unknown) => unknown) => run(mocks.transaction) } }));
vi.mock("@/features/pages/pages.repository", () => ({ lockPage: mocks.lockPage, findPage: vi.fn() }));
vi.mock("./annotations.repository", () => ({
  insertAnnotation: mocks.insertAnnotation, insertTextAnnotation: vi.fn(),
  findAnnotation: vi.fn(), updateAnnotationContent: vi.fn(),
}));
import { createAnnotation } from "./annotations.service";

const userId = asUserId("11111111-1111-4111-8111-111111111111");
const input = {
  pageId: asPageId("22222222-2222-4222-8222-222222222222"),
  imageStorageKey: "source.jpg", rect: { x: 0.2, y: 0.3, width: 0.2, height: 0.1 }, userComment: "Note",
};
beforeEach(() => { vi.clearAllMocks(); });

describe("region-note creation", () => {
  it("locks the owned page and inserts inside the same transaction", async () => {
    mocks.lockPage.mockResolvedValue({ storageKey: "source.jpg" });
    mocks.insertAnnotation.mockResolvedValue({ id: "note" });
    expect(await createAnnotation(userId, input)).toEqual({ status: "created", annotation: { id: "note" } });
    expect(mocks.lockPage).toHaveBeenCalledWith(mocks.transaction, userId, input.pageId);
    expect(mocks.insertAnnotation).toHaveBeenCalledWith(userId, input, mocks.transaction);
    expect(mocks.lockPage.mock.invocationCallOrder[0]).toBeLessThan(mocks.insertAnnotation.mock.invocationCallOrder[0]!);
  });

  it("rejects a rectangle drawn before a concurrent crop save", async () => {
    mocks.lockPage.mockResolvedValue({ storageKey: "new-crop.jpg" });
    expect(await createAnnotation(userId, input)).toEqual({ status: "stale-image" });
    expect(mocks.insertAnnotation).not.toHaveBeenCalled();
  });

  it("does not create a note on a missing or inaccessible page", async () => {
    mocks.lockPage.mockResolvedValue(null);
    expect(await createAnnotation(userId, input)).toEqual({ status: "not-found" });
    expect(mocks.insertAnnotation).not.toHaveBeenCalled();
  });
});
