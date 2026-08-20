"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { BookId } from "@/db/ids";

import { apiErrorSchema, uploadTargetResponseSchema } from "../pages.schema";
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
  const [state, setState] = useState<UploadState>({ status: "idle" });

  async function upload(formData: FormData) {
    const file = formData.get("file");
    const pageNumberRaw = formData.get("pageNumber");

    if (!(file instanceof File) || file.size === 0) {
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
      className="flex flex-col gap-3 rounded-lg border border-ink-muted/20 p-4"
    >
      <h2 className="font-medium">Add a page</h2>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>Page number</span>
          <input
            name="pageNumber"
            type="number"
            required
            className="w-28 rounded-md border border-ink-muted/30 bg-transparent px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>Photograph</span>
          <input
            name="file"
            type="file"
            accept={ACCEPTED_CONTENT_TYPES.join(",")}
            required
            className="text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={isWorking}
          className="rounded-md bg-accent px-4 py-2 font-medium text-paper disabled:opacity-60"
        >
          {isWorking ? "Working…" : "Upload"}
        </button>
      </div>

      {state.status === "working" ? (
        <p role="status" className="text-sm text-ink-muted">
          {state.step}
        </p>
      ) : null}

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
