"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { BookId } from "@/db/ids";

import { apiErrorSchema, uploadTargetResponseSchema } from "../pages.schema";
import {
  CornerPicker,
  DEFAULT_CORNERS,
  type Corners,
} from "./corner-picker";
import { ACCEPTED_CONTENT_TYPES } from "../pages.storage-key";

/** Matches the bucket's own limit, which is the one that actually holds. */
const MAX_BYTES = 10 * 1024 * 1024;

type UploadState =
  | { status: "idle" }
  | { status: "working"; step: string }
  | { status: "error"; message: string };

async function readErrorMessage(response: Response, fallback: string) {
  const body: unknown = await response.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error : fallback;
}

/**
 * Uploads a page image in three steps, and the middle one does not involve this
 * app at all:
 *
 *   1. POST /api/pages/upload-url  — ask for somewhere to put it
 *   2. PUT  <supabase signed url>  — the bytes go straight to Supabase
 *   3. POST /api/pages             — record the page
 *
 * Step 2 is why this is a client component rather than a form: the file never
 * passes through our server, so there is nothing to submit to it.
 */
export function PageUploader({ bookId }: { bookId: BookId }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ status: "idle" });

  /**
   * The chosen file and a preview URL for it, kept together so the URL is
   * always the one belonging to the current file. The URL is created in the
   * change handler rather than in an effect, because it is a consequence of an
   * event and not something to be synchronised.
   */
  const [chosen, setChosen] = useState<{ file: File; url: string } | null>(null);
  const [corners, setCorners] = useState<Corners>(DEFAULT_CORNERS);
  const [straighten, setStraighten] = useState(true);

  // Object URLs are a manual allocation: without this the blob stays in memory
  // for the life of the tab.
  useEffect(() => () => {
    if (chosen) URL.revokeObjectURL(chosen.url);
  }, [chosen]);

  function chooseFile(file: File | null) {
    if (!file && fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setChosen((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return file ? { file, url: URL.createObjectURL(file) } : null;
    });
    // A new photograph means the old corners mean nothing.
    setCorners(DEFAULT_CORNERS);
    setState({ status: "idle" });
  }

  async function upload(formData: FormData) {
    const file = chosen?.file;
    const pageNumberRaw = formData.get("pageNumber");

    if (!file || file.size === 0) {
      setState({ status: "error", message: "Choose an image first." });
      return;
    }

    if (!ACCEPTED_CONTENT_TYPES.includes(file.type)) {
      setState({
        status: "error",
        message: "Only JPEG, PNG and WebP images are accepted.",
      });
      return;
    }

    // Checked here for a fast, clear message; the bucket enforces the same
    // limit server-side, which is what actually stops an oversized upload.
    if (file.size > MAX_BYTES) {
      setState({ status: "error", message: "That image is larger than 10 MB." });
      return;
    }

    const pageNumber = Number(pageNumberRaw);

    if (!Number.isInteger(pageNumber)) {
      setState({ status: "error", message: "Enter a page number." });
      return;
    }

    try {
      // The intrinsic size of the image, read from the file itself. Every
      // annotation rectangle on this page is stored as a fraction of these two
      // numbers, which is why they are captured now rather than measured from
      // whatever the screen happens to be showing later.
      setState({ status: "working", step: "Reading image…" });
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();

      setState({ status: "working", step: "Requesting an upload URL…" });
      const targetResponse = await fetch("/api/pages/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, contentType: file.type }),
      });

      if (!targetResponse.ok) {
        setState({
          status: "error",
          message: await readErrorMessage(
            targetResponse,
            "Could not start the upload.",
          ),
        });
        return;
      }

      const target = uploadTargetResponseSchema.safeParse(
        await targetResponse.json(),
      );

      if (!target.success) {
        setState({ status: "error", message: "Unexpected upload response." });
        return;
      }

      setState({ status: "working", step: "Uploading…" });

      // Supabase's signed upload endpoint expects multipart form data with the
      // file under an empty field name, not a raw body. The signed URL already
      // carries its token, so no credentials are attached here — which is the
      // point: this request goes to Supabase, not to us.
      const uploadBody = new FormData();
      uploadBody.append("cacheControl", "3600");
      uploadBody.append("", file);

      const uploadResponse = await fetch(target.data.url, {
        method: "PUT",
        headers: { "x-upsert": "false" },
        body: uploadBody,
      });

      if (!uploadResponse.ok) {
        setState({
          status: "error",
          message: `Upload failed (${uploadResponse.status}).`,
        });
        return;
      }

      setState({ status: "working", step: "Saving page…" });
      const completeResponse = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          pageNumber,
          storageKey: target.data.storageKey,
          imageWidth: width,
          imageHeight: height,
          // Omitted entirely when the reader does not want the page
          // straightened, in which case the server falls back to trying to
          // find the page itself.
          ...(straighten ? { corners } : {}),
        }),
      });

      if (!completeResponse.ok) {
        setState({
          status: "error",
          message: await readErrorMessage(
            completeResponse,
            "Could not save the page.",
          ),
        });
        return;
      }

      setState({ status: "idle" });
      chooseFile(null);
      // The page list is server-rendered, so ask the server for it again rather
      // than trying to keep a client-side copy in step.
      router.refresh();
    } catch {
      setState({
        status: "error",
        message: "Something went wrong during the upload.",
      });
    }
  }

  const isWorking = state.status === "working";

  return (
    <form
      action={upload}
      className="overflow-hidden border-y border-rule bg-paper-raised"
    >
      <div className="grid lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.6fr)]">
        <header className="relative overflow-hidden border-b border-rule bg-paper px-6 py-7 lg:border-b-0 lg:border-r lg:px-7 lg:py-8">
          <span
            aria-hidden
            className="absolute -right-2 -top-7 font-serif text-[8rem] leading-none text-paper-deep"
          >
            01
          </span>
          <div className="relative">
            <p className="text-[11px] uppercase tracking-[0.2em] text-accent">
              New leaf
            </p>
            <h2 className="mt-2 font-serif text-3xl leading-none">Add a page</h2>
            <p className="mt-4 max-w-[30ch] text-sm leading-6 text-ink-muted">
              Pair the printed page number with a clear photograph. You can
              straighten its edges before saving.
            </p>
          </div>
        </header>

        <div className="flex min-w-0 flex-col">
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-[9rem_minmax(0,1fr)] sm:px-7 sm:py-7">
            <label className="flex flex-col gap-2 text-sm">
              <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
                Page number
              </span>
              <input
                name="pageNumber"
                type="number"
                required
                placeholder="317"
                className="h-14 w-full border border-rule bg-paper px-4 font-serif text-xl tabular-nums outline-none transition-colors focus:border-accent"
              />
            </label>

            <label className="flex min-w-0 flex-col gap-2 text-sm">
              <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
                Photograph
              </span>
              <span className="relative flex h-14 min-w-0 cursor-pointer items-center gap-3 border border-rule bg-paper px-4 transition-colors hover:border-ink-muted">
                <input
                  ref={fileInputRef}
                  name="file"
                  type="file"
                  accept={ACCEPTED_CONTENT_TYPES.join(",")}
                  required
                  onChange={(event) =>
                    chooseFile(event.target.files?.[0] ?? null)
                  }
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="size-5 shrink-0 fill-none stroke-current text-accent"
                  strokeWidth="1.6"
                >
                  <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
                  <path d="M5 14v5h14v-5" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {chosen ? chosen.file.name : "Choose a photograph"}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-muted">
                    {chosen
                      ? `${(chosen.file.size / 1024 / 1024).toFixed(1)} MB selected`
                      : "JPEG, PNG or WebP · up to 10 MB"}
                  </span>
                </span>
                <span className="hidden text-xs font-medium text-accent sm:block">
                  Browse
                </span>
              </span>
            </label>
          </div>
        </div>
      </div>

      {chosen ? (
        <div className="border-t border-rule px-6 py-6 sm:px-7">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
                Page alignment
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                Drag the four handles if the suggested crop needs adjustment.
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 border border-rule bg-paper px-3 py-2 text-xs font-medium uppercase tracking-[0.08em] text-ink-muted">
              <input
                type="checkbox"
                checked={straighten}
                onChange={(event) => setStraighten(event.target.checked)}
                className="accent-accent"
              />
              Straighten page
            </label>
          </div>

          {straighten ? (
            <CornerPicker
              imageUrl={chosen.url}
              corners={corners}
              onChange={setCorners}
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-16 flex-wrap items-center justify-between gap-4 border-t border-rule bg-paper/45 px-6 py-3 sm:px-7">
        <div className="min-w-0 flex-1">
          {state.status === "working" ? (
            <p role="status" className="text-sm text-ink-muted">
              {state.step}
            </p>
          ) : state.status === "error" ? (
            <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
              {state.message}
            </p>
          ) : (
            <p className="text-xs text-ink-muted">
              The original photograph stays private.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isWorking}
          className="inline-flex min-w-32 items-center justify-center gap-3 bg-accent px-5 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-danger disabled:cursor-wait disabled:opacity-60"
        >
          {isWorking ? "Working…" : "Upload page"}
          <span aria-hidden className="text-base leading-none">
            →
          </span>
        </button>
      </div>
    </form>
  );
}
