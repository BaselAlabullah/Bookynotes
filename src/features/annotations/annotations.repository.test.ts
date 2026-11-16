import { beforeEach, describe, expect, it, vi } from "vitest";
import { asAnnotationId, asUserId } from "@/db/ids";

const mocks = vi.hoisted(() => ({ set: vi.fn(), returning: vi.fn() }));
vi.mock("@/db/client", () => ({
  db: { update: () => ({ set: mocks.set }) },
}));
import { recordEnrichmentFailure } from "./annotations.repository";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.set.mockReturnValue({ where: () => ({ returning: mocks.returning }) });
  mocks.returning.mockResolvedValue([{ retryCount: 2, enrichmentStatus: "pending" }]);
});

describe("enrichment retry accounting", () => {
  const user = asUserId("user");
  const annotation = asAnnotationId("annotation");

  it("records a quota error without updating the stored retry count", async () => {
    await recordEnrichmentFailure(user, annotation, "Rate limited", false, { countAttempt: false });
    expect(mocks.set.mock.calls[0]![0]).not.toHaveProperty("retryCount");
    expect(mocks.set.mock.calls[0]![0]).toMatchObject({ enrichmentError: "Rate limited", enrichmentStatus: "pending" });
  });

  it("still counts ordinary failures and records terminal status", async () => {
    await recordEnrichmentFailure(user, annotation, "Invalid key", true);
    expect(mocks.set.mock.calls[0]![0]).toHaveProperty("retryCount");
    expect(mocks.set.mock.calls[0]![0]).toMatchObject({ enrichmentStatus: "failed" });
  });
});
