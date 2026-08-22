"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { PageId } from "@/db/ids";

import { updatePageCornersAction } from "../pages.actions";
import type { PageCorners } from "../pages.schema";
import { CornerPicker, DEFAULT_CORNERS } from "./corner-picker";

export function PageCornerEditor({
  pageId,
  imageUrl,
  initialCorners,
}: {
  pageId: PageId;
  imageUrl: string;
  initialCorners: PageCorners | null;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [corners, setCorners] = useState<PageCorners>(
    initialCorners ?? DEFAULT_CORNERS,
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  function cancel() {
    setCorners(initialCorners ?? DEFAULT_CORNERS);
    setError(null);
    setIsOpen(false);
  }

  function save() {
    setError(null);
    startSaving(async () => {
      let result: Awaited<ReturnType<typeof updatePageCornersAction>>;

      try {
        result = await updatePageCornersAction({ pageId, corners });
      } catch {
        setError("The page update could not be reached. Try again.");
        return;
      }

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setIsOpen(false);
      router.refresh();
    });
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="screen-only w-fit text-xs font-medium text-accent underline decoration-accent/40 underline-offset-4"
      >
        Adjust page corners
      </button>
    );
  }

  return (
    <section className="screen-only border-y border-rule bg-paper-raised px-5 py-5 sm:px-7">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl">Adjust page corners</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-muted">
            Move the dots on the original photograph. Existing margin notes
            will be moved into the corrected page automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={cancel}
          disabled={isSaving}
          className="text-xs text-ink-muted underline decoration-rule underline-offset-4 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      <CornerPicker imageUrl={imageUrl} corners={corners} onChange={setCorners} />

      {error ? (
        <p role="alert" className="mt-4 border-l-2 border-danger pl-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={isSaving}
          className="bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
        >
          {isSaving ? "Straightening page…" : "Save corners"}
        </button>
        <p className="text-xs text-ink-muted">
          The source photograph is kept; saving creates a new corrected copy.
        </p>
      </div>
    </section>
  );
}
