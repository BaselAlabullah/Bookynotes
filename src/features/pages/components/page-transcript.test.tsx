import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { asPageId } from "@/db/ids";
import { PageTranscript } from "./page-transcript";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/annotations/components/transcript-reader", () => ({
  TranscriptReader: ({ transcript }: { transcript: string }) => <p data-testid="transcript">{transcript}</p>,
}));

const props = {
  pageId: asPageId("11111111-1111-4111-8111-111111111111"),
  transcript: "Original transcript", status: "complete" as const,
  error: null, pageNumber: 1, printedPageNumber: null,
  annotations: [], selectedId: null, onSelect: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function saveManualEdit(text = "Manual correction") {
  fireEvent.click(screen.getByRole("button", { name: "Edit transcript" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Save transcript" }));
  await waitFor(() => expect(screen.getByTestId("transcript").textContent).toBe(text));
}

describe("transcript replacement", () => {
  it("shows the server's replacement after a manual edit", async () => {
    const { rerender } = render(<PageTranscript {...props} />);
    await saveManualEdit();
    fireEvent.click(screen.getByRole("button", { name: "Replace with AI" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    rerender(<PageTranscript {...props} transcript="New model transcript" />);
    expect(screen.getByTestId("transcript").textContent).toBe("New model transcript");
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("?force=true"), { method: "POST" });
  });

  it("reconciles a manual save with subsequent server updates", async () => {
    const { rerender } = render(<PageTranscript {...props} />);
    await saveManualEdit();
    rerender(<PageTranscript {...props} transcript="Manual correction" />);
    expect(screen.getByTestId("transcript").textContent).toBe("Manual correction");
    rerender(<PageTranscript {...props} transcript="Edit from another session" />);
    expect(screen.getByTestId("transcript").textContent).toBe("Edit from another session");
  });

  it("keeps the saved manual text when model replacement fails", async () => {
    render(<PageTranscript {...props} />);
    await saveManualEdit();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Quota exhausted" }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: "Replace with AI" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Quota exhausted");
    expect(screen.getByTestId("transcript").textContent).toBe("Manual correction");
  });
});
