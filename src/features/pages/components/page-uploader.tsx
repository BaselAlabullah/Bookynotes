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
  | { status: "working"; step: string; progress?: number }
  | { status: "error"; message: string };

type CaptureCheck =
  | { status: "idle" }
  | { status: "checking" }
  | {
      status: "ready";
      width: number;
      height: number;
      megapixels: number;
      warnings: string[];
      tips: string[];
    }
  | { status: "unavailable"; message: string };

async function readErrorMessage(response: Response, fallback: string) {
  const body: unknown = await response.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error : fallback;
}

function firstAcceptedImage(files: FileList | File[] | null | undefined) {
  if (!files) return null;

  return (
    Array.from(files).find((file) =>
      ACCEPTED_CONTENT_TYPES.includes(file.type),
    ) ?? null
  );
}

function uploadFileToSignedUrl({
  url,
  file,
  onProgress,
}: {
  url: string;
  file: File;
  onProgress: (progress: number) => void;
}) {
  return new Promise<{ status: number }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const uploadBody = new FormData();

    uploadBody.append("cacheControl", "3600");
    uploadBody.append("", file);

    request.open("PUT", url);
    request.setRequestHeader("x-upsert", "false");

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total === 0) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    request.onerror = () => reject(new Error("Upload failed before it reached storage."));
    request.onabort = () => reject(new Error("Upload was cancelled."));
    request.onload = () => resolve({ status: request.status });
    request.send(uploadBody);
  });
}

async function inspectCapture(file: File): Promise<Extract<CaptureCheck, { status: "ready" }>> {
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  const sampleSize = 96;
  const canvas = document.createElement("canvas");
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    bitmap.close();
    throw new Error("Could not inspect this image.");
  }

  context.drawImage(bitmap, 0, 0, sampleSize, sampleSize);
  bitmap.close();

  const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
  let brightnessTotal = 0;
  const luminance: number[] = [];

  for (let index = 0; index < pixels.length; index += 4) {
    const gray =
      0.2126 * (pixels[index] ?? 0) +
      0.7152 * (pixels[index + 1] ?? 0) +
      0.0722 * (pixels[index + 2] ?? 0);
    brightnessTotal += gray;
    luminance.push(gray);
  }

  const brightness = brightnessTotal / luminance.length;
  const contrast = Math.sqrt(
    luminance.reduce((total, value) => total + (value - brightness) ** 2, 0) /
      luminance.length,
  );
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const megapixels = (width * height) / 1_000_000;
  const warnings: string[] = [];
  const tips: string[] = [];

  if (shortSide < 900 || megapixels < 1) {
    warnings.push("Low resolution");
    tips.push("Move the camera closer or use the original camera file.");
  }

  if (width > height) {
    warnings.push("Landscape photo");
    tips.push("Portrait pages usually read better when captured upright.");
  }

  if (longSide / shortSide > 2.2) {
    warnings.push("Very narrow crop");
    tips.push("Make sure the whole page is visible, not just a strip of text.");
  }

  if (brightness < 55) {
    warnings.push("Dark image");
    tips.push("Add light or move away from shadows before uploading.");
  } else if (brightness > 220) {
    warnings.push("Very bright image");
    tips.push("Avoid glare; text can disappear in overexposed areas.");
  }

  if (contrast < 28) {
    warnings.push("Low contrast");
    tips.push("Try a darker background or stronger, even lighting.");
  }

  if (file.size > 8 * 1024 * 1024) {
    tips.push("This file is large; upload may be slower on Vercel/Supabase.");
  }

  return {
    status: "ready",
    width,
    height,
    megapixels,
    warnings: Array.from(new Set(warnings)),
    tips: Array.from(new Set(tips)),
  };
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
export function PageUploader({
  bookId,
  nextPageNumber,
}: {
  bookId: BookId;
  nextPageNumber: number;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureCheckIdRef = useRef(0);
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [pageNumberValue, setPageNumberValue] = useState(
    String(nextPageNumber),
  );

  /**
   * The chosen file and a preview URL for it, kept together so the URL is
   * always the one belonging to the current file. The URL is created in the
   * change handler rather than in an effect, because it is a consequence of an
   * event and not something to be synchronised.
   */
  const [chosen, setChosen] = useState<{ file: File; url: string } | null>(null);
  const [captureCheck, setCaptureCheck] = useState<CaptureCheck>({
    status: "idle",
  });
  const [corners, setCorners] = useState<Corners>(DEFAULT_CORNERS);
  const [straighten, setStraighten] = useState(true);

  // Object URLs are a manual allocation: without this the blob stays in memory
  // for the life of the tab.
  useEffect(() => () => {
    if (chosen) URL.revokeObjectURL(chosen.url);
  }, [chosen]);

  function chooseFile(file: File | null) {
    const checkId = captureCheckIdRef.current + 1;
    captureCheckIdRef.current = checkId;

    if (!file && fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setChosen((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return file ? { file, url: URL.createObjectURL(file) } : null;
    });
    // A new photograph means the old corners mean nothing.
    setCorners(DEFAULT_CORNERS);
    setCaptureCheck(file ? { status: "checking" } : { status: "idle" });
    setState({ status: "idle" });

    if (file) {
      void inspectCapture(file)
        .then((result) => {
          if (captureCheckIdRef.current === checkId) {
            setCaptureCheck(result);
          }
        })
        .catch(() => {
          if (captureCheckIdRef.current === checkId) {
            setCaptureCheck({
              status: "unavailable",
              message: "Capture quality could not be checked for this file.",
            });
          }
        });
    }
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

      setState({ status: "working", step: "Uploading...", progress: 0 });

      // Supabase's signed upload endpoint expects multipart form data with the
      // file under an empty field name, not a raw body. The signed URL already
      // carries its token, so no credentials are attached here — which is the
      // point: this request goes to Supabase, not to us.
      const uploadResponse = await uploadFileToSignedUrl({
        url: target.data.url,
        file,
        onProgress: (progress) =>
          setState({
            status: "working",
            step: "Uploading...",
            progress,
          }),
      });

      if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
        setState({
          status: "error",
          message: `Upload failed (${uploadResponse.status}). Keep the file selected and try again.`,
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
      setPageNumberValue(String(pageNumber + 1));
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
      onDragOver={(event) => {
        if (state.status === "working") return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (state.status === "working") return;

        const file = firstAcceptedImage(event.dataTransfer.files);

        if (!file) return;

        event.preventDefault();
        chooseFile(file);
      }}
      onPaste={(event) => {
        if (chosen || state.status === "working") return;

        const file = firstAcceptedImage(event.clipboardData.files);

        if (!file) return;

        event.preventDefault();
        chooseFile(file);
      }}
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
                value={pageNumberValue}
                onChange={(event) => setPageNumberValue(event.target.value)}
                placeholder={String(nextPageNumber)}
                className="h-14 w-full border border-rule bg-paper px-4 font-serif text-xl tabular-nums outline-none transition-colors focus:border-accent"
              />
              <span className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                Suggested next page: {nextPageNumber}
                <button
                  type="button"
                  onClick={() => setPageNumberValue(String(nextPageNumber))}
                  className="underline decoration-rule underline-offset-4 hover:text-ink"
                >
                  Use it
                </button>
              </span>
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
                  capture="environment"
                  required
                  onChange={(event) =>
                    chooseFile(firstAcceptedImage(event.target.files))
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
                      : "JPEG, PNG or WebP - paste, drop, or browse"}
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
          <CaptureQualityPanel check={captureCheck} />

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
            <div role="status" className="flex flex-col gap-2">
              <p className="text-sm text-ink-muted">
                {typeof state.progress === "number"
                  ? `${state.step} ${state.progress}%`
                  : state.step}
              </p>
              {typeof state.progress === "number" ? (
                <div className="h-1.5 w-full max-w-xs overflow-hidden bg-paper-deep">
                  <div
                    className="h-full bg-accent transition-[width]"
                    style={{ width: `${state.progress}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : state.status === "error" ? (
            <div role="alert" className="border-l-2 border-danger pl-3">
              <p className="text-sm text-danger">{state.message}</p>
              {chosen ? (
                <p className="mt-1 text-xs text-ink-muted">
                  The photograph is still selected. Adjust the details or try
                  again.
                </p>
              ) : null}
            </div>
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
          {isWorking
            ? "Working..."
            : state.status === "error" && chosen
              ? "Try again"
              : "Upload page"}
          <span aria-hidden className="text-base leading-none">
            →
          </span>
        </button>
      </div>
    </form>
  );
}

function CaptureQualityPanel({ check }: { check: CaptureCheck }) {
  if (check.status === "idle") {
    return null;
  }

  return (
    <section className="mb-5 border border-rule bg-paper px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
            Capture check
          </p>
          {check.status === "checking" ? (
            <p className="mt-1 text-sm text-ink-muted">Checking the photograph...</p>
          ) : check.status === "unavailable" ? (
            <p className="mt-1 text-sm text-ink-muted">{check.message}</p>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">
              {check.width} × {check.height} · {check.megapixels.toFixed(1)} MP
            </p>
          )}
        </div>

        {check.status === "ready" ? (
          <span
            className={`border px-2 py-1 text-[11px] uppercase tracking-[0.1em] ${
              check.warnings.length === 0
                ? "border-rule text-ink-muted"
                : "border-accent/40 text-accent"
            }`}
          >
            {check.warnings.length === 0 ? "Looks usable" : "Review photo"}
          </span>
        ) : null}
      </div>

      {check.status === "ready" ? (
        check.warnings.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            The image has enough resolution and contrast for annotation and
            model reading. Nice, tidy little page goblin approved.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {check.warnings.map((warning) => (
                <span
                  key={warning}
                  className="border border-accent/40 px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-accent"
                >
                  {warning}
                </span>
              ))}
            </div>

            <ul className="list-disc space-y-1 pl-4 text-sm leading-6 text-ink-muted">
              {check.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </section>
  );
}
