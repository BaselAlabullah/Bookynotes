import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Annotation } from "../annotations.types";
import { useAnnotationEnrichment } from "./use-annotation-enrichment";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const notes = [
  { id: "first", enrichmentStatus: "pending" },
  { id: "second", enrichmentStatus: "failed" },
] as Annotation[];
const onError = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "complete" }) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("annotation extraction queue", () => {
  it("extracts all queued notes and forces retries only for failed notes", async () => {
    const { result } = renderHook(() => useAnnotationEnrichment(notes, onError));
    await act(() => result.current.extractMissingPassages());
    expect(fetch).toHaveBeenNthCalledWith(1, "/api/annotations/first/enrich", { method: "POST" });
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/annotations/second/enrich?force=true", { method: "POST" });
    expect(result.current.batchExtraction).toMatchObject({ status: "done", current: 2, total: 2 });
    expect(result.current.enriching.size).toBe(0);
    expect(refresh).toHaveBeenCalled();
  });

  it("stops at a provider failure and leaves later notes unrequested", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Quota exhausted" }) } as Response);
    const { result } = renderHook(() => useAnnotationEnrichment(notes, onError));
    await act(() => result.current.extractMissingPassages());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.batchExtraction).toMatchObject({ status: "stopped", current: 1 });
    expect(onError).toHaveBeenLastCalledWith("Quota exhausted");
    expect(result.current.enriching.size).toBe(0);
  });

  it("clears the busy state when an individual request cannot reach the server", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
    const { result } = renderHook(() => useAnnotationEnrichment(notes, onError));
    await act(() => result.current.enrich("first"));
    expect(onError).toHaveBeenLastCalledWith("Could not reach the extraction service.");
    expect(result.current.enriching.size).toBe(0);
    expect(refresh).toHaveBeenCalled();
  });
});
