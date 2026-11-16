import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asAnnotationId, asUserId } from "@/db/ids";
import { VisionRateLimitError, VisionPermanentError } from "@/integrations/vision/vision.types";

const mocks = vi.hoisted(() => ({
  extractPassage: vi.fn(), findAnnotation: vi.fn(), recordEnrichmentFailure: vi.fn(), completeEnrichment: vi.fn(),
}));
vi.mock("./annotations.repository", () => ({ ...mocks, resetEnrichment: vi.fn() }));
vi.mock("@/features/pages/pages.repository", () => ({ findPage: async () => ({ storageKey: "page.jpg" }) }));
vi.mock("@/integrations/storage/storage.client", () => ({ createSignedRead: async () => ({ url: "https://storage.example/page.jpg" }) }));
vi.mock("@/integrations/vision/vision.client", () => ({ extractPassage: mocks.extractPassage }));
vi.mock("./annotations.crop", () => ({ prepareCropForModel: async () => ({ image: Buffer.from("crop"), mimeType: "image/jpeg" }) }));
import { enrichAnnotation } from "./annotations.enrichment";

const user = asUserId("user");
const id = asAnnotationId("annotation");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findAnnotation.mockResolvedValue({ id, pageId: "page", anchor: "region", enrichmentStatus: "pending", retryCount: 2 });
  mocks.recordEnrichmentFailure.mockResolvedValue({ id });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
});
afterEach(() => vi.unstubAllGlobals());

describe("enrichment outcomes", () => {
  it("keeps quota failures retryable without spending the remaining attempt", async () => {
    mocks.extractPassage.mockRejectedValue(new VisionRateLimitError("Quota exhausted"));
    expect(await enrichAnnotation(user, id)).toMatchObject({ status: "retryable" });
    expect(mocks.recordEnrichmentFailure).toHaveBeenCalledWith(user, id, expect.any(String), false, { countAttempt: false });
  });

  it("still marks a permanent provider failure as failed", async () => {
    mocks.extractPassage.mockRejectedValue(new VisionPermanentError("Invalid key"));
    expect(await enrichAnnotation(user, id)).toMatchObject({ status: "failed" });
    expect(mocks.recordEnrichmentFailure).toHaveBeenCalledWith(user, id, "Invalid key", true);
  });

  it("does not call the model for an already-complete annotation", async () => {
    mocks.findAnnotation.mockResolvedValue({ id, anchor: "region", enrichmentStatus: "complete" });
    expect(await enrichAnnotation(user, id)).toMatchObject({ status: "cached" });
    expect(mocks.extractPassage).not.toHaveBeenCalled();
  });

  it("never sends text annotations to a model, including forced retries", async () => {
    mocks.findAnnotation.mockResolvedValue({ id, anchor: "text", enrichmentStatus: "complete" });
    expect(await enrichAnnotation(user, id, { force: true })).toMatchObject({ status: "cached" });
    expect(mocks.extractPassage).not.toHaveBeenCalled();
  });
});
