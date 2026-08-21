import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ResilientImage } from "./resilient-image";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ResilientImage", () => {
  test("server HTML retains src for preload scanning and no-JS rendering", () => {
    const html = renderToString(
      <ResilientImage
        src="https://storage.example/cover.jpg?token=valid"
        alt="Cover"
        loading="eager"
        fetchPriority="high"
      />,
    );

    expect(html).toContain(
      'src="https://storage.example/cover.jpg?token=valid"',
    );
    expect(html).toContain('fetchPriority="high"');
  });

  test("recovers a pre-hydration failure, coalesces signing, and resets after load", async () => {
    vi.useFakeTimers();
    let complete = true;
    let naturalWidth = 0;

    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockImplementation(
      () => complete,
    );
    vi.spyOn(
      HTMLImageElement.prototype,
      "naturalWidth",
      "get",
    ).mockImplementation(() => naturalWidth);

    const freshResponse = {
      ok: true,
      json: async () => ({ url: "https://storage.example/fresh.jpg?token=new" }),
    };
    let resolveFetch: (response: typeof freshResponse) => void = () => undefined;
    const pendingFetch = new Promise<typeof freshResponse>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pendingFetch);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <>
        <ResilientImage
          src="https://storage.example/stale.jpg?token=old"
          storageKey="user/cover.jpg"
          alt="First cover"
        />
        <ResilientImage
          src="https://storage.example/stale.jpg?token=old"
          storageKey="user/cover.jpg"
          alt="Second cover"
        />
      </>,
    );

    // Both elements report the failure that occurred before onError attached.
    // Once recovery starts, the replacement request is pending rather than a
    // second already-completed failure.
    complete = false;
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFetch(freshResponse);
      await pendingFetch;
    });
    const images = screen.getAllByRole("img") as HTMLImageElement[];
    expect(images).toHaveLength(2);
    expect(images[0]?.src).toContain("token=new");
    expect(images[1]?.src).toContain("token=new");

    // A successful load restores the full retry budget: the next failure uses
    // the first 300ms delay, rather than continuing at 800ms.
    complete = true;
    naturalWidth = 100;
    fireEvent.load(images[0] as HTMLImageElement);
    naturalWidth = 0;
    fireEvent.error(images[0] as HTMLImageElement);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
