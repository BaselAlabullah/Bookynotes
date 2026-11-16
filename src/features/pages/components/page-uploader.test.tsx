import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asBookId } from "@/db/ids";
import { PageUploader } from "./page-uploader";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), upload: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../pages.upload", () => ({ uploadFileToSignedUrl: mocks.upload }));
vi.mock("../pages.capture", () => ({
  inspectCapture: async () => ({ status: "ready", width: 1200, height: 1600, megapixels: 1.92, warnings: [], tips: [] }),
  readImageDimensions: async () => ({ width: 1200, height: 1600 }),
}));
vi.mock("./corner-picker", () => ({
  CornerPicker: () => <div>Corner preview</div>,
  DEFAULT_CORNERS: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue({ status: 200 });
  vi.stubGlobal("URL", class extends URL {
    static override createObjectURL() { return "blob:photo"; }
    static override revokeObjectURL() {}
  });
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://storage.example/upload", token: "token", storageKey: "image.jpg" }) })
    .mockResolvedValueOnce({ ok: true }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("page upload", () => {
  it.each([true, false])("sends the reader's straightening choice (%s) and keeps upload behavior", async (straighten) => {
    const { container } = render(<PageUploader bookId={asBookId("book")} nextPageNumber={4} />);
    const file = new File(["photo"], "page.jpg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    const checkbox = await screen.findByRole("checkbox", { name: /Straighten page/i });
    if (!straighten) fireEvent.click(checkbox);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());

    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ file, url: "https://storage.example/upload" }));
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/pages")!;
    const body = JSON.parse(String(request[1]?.body));
    expect(body).toMatchObject({ pageNumber: 4, straighten, storageKey: "image.jpg", imageWidth: 1200, imageHeight: 1600 });
    expect(Boolean(body.corners)).toBe(straighten);
    expect(screen.getByRole("spinbutton")).toHaveProperty("value", "5");
  });
});
