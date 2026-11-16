import type { Annotation } from "../annotations.types";

export type CopyMode = "note" | "passage" | "all";
export type AnnotationEditDraft = {
  userComment: string;
  extractedPassage: string;
  extractedContext: string;
};

/** What the model found, or an honest account of why it has not yet. */
export function AnnotationExtraction({ annotation, isEnriching }: { annotation: Annotation; isEnriching: boolean }) {
  if (isEnriching) return <span role="status" className="mt-2 block text-xs italic text-ink-muted">Reading the passage…</span>;
  if (annotation.enrichmentStatus === "pending") {
    const attempts =
      annotation.retryCount > 0
        ? ` Attempt ${annotation.retryCount + 1} will run next.`
        : "";

    return (
      <span className="mt-2 block text-xs italic text-ink-muted">
        Passage not extracted yet.
        {annotation.enrichmentError ? ` Last issue: ${annotation.enrichmentError}` : ""}
        {attempts}
      </span>
    );
  }
  if (annotation.enrichmentStatus === "failed") {
    return (
      <span className="mt-2 block text-xs italic text-danger">
        Extraction failed after {annotation.retryCount}{" "}
        {annotation.retryCount === 1 ? "attempt" : "attempts"}.
        {annotation.enrichmentError ? ` ${annotation.enrichmentError}` : ""}
      </span>
    );
  }
  return <AnnotationReviewBlocks annotation={annotation} />;
}

export function AnnotationReviewBlocks({ annotation }: { annotation: Annotation }) {
  if (!annotation.extractedPassage && !annotation.extractedContext) {
    return null;
  }

  return (
    <span className="mt-3 flex flex-col gap-3">
      {annotation.extractedPassage ? (
        <span className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
            Read passage
          </span>
          <span className="font-serif text-[0.95rem] leading-6 text-ink-muted">
            “{annotation.extractedPassage}”
          </span>
        </span>
      ) : null}

      {annotation.extractedContext ? (
        <span className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
            Context
          </span>
          <span className="text-xs leading-5 text-ink-muted">
            {annotation.extractedContext}
          </span>
        </span>
      ) : null}
    </span>
  );
}

export function AnnotationCopyActions({
  annotation,
  copied,
  onCopy,
}: {
  annotation: Annotation;
  copied: boolean;
  onCopy: (mode: CopyMode) => void;
}) {
  const hasNote = annotation.userComment.trim().length > 0;
  const hasPassage =
    Boolean(annotation.extractedPassage?.trim()) ||
    Boolean(annotation.extractedContext?.trim());

  if (!hasNote && !hasPassage) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
      {hasNote ? (
        <button
          type="button"
          onClick={() => onCopy("note")}
          className="text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink"
        >
          Copy note
        </button>
      ) : null}
      {hasPassage ? (
        <button
          type="button"
          onClick={() => onCopy("passage")}
          className="text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink"
        >
          Copy passage
        </button>
      ) : null}
      {hasNote && hasPassage ? (
        <button
          type="button"
          onClick={() => onCopy("all")}
          className="text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink"
        >
          Copy all
        </button>
      ) : null}
      {copied ? (
        <span role="status" className="text-accent">
          Copied
        </span>
      ) : null}
    </div>
  );
}

export function formatAnnotationForClipboard(
  annotation: Annotation,
  mode: CopyMode,
) {
  const note = annotation.userComment.trim();
  const passage = annotation.extractedPassage?.trim() ?? "";
  const context = annotation.extractedContext?.trim() ?? "";

  if (mode === "note") {
    return note;
  }

  if (mode === "passage") {
    return [passage ? `Passage:\n${passage}` : "", context ? `Context:\n${context}` : ""]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    note ? `Note:\n${note}` : "",
    passage ? `Passage:\n${passage}` : "",
    context ? `Context:\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function AnnotationEditForm({
  draft,
  error,
  isSaving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: AnnotationEditDraft;
  error: string | null;
  isSaving: boolean;
  onChange: (draft: AnnotationEditDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <section className="flex flex-col gap-3 border-y border-accent/50 py-3">
      <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.12em] text-ink-muted">
        Note
        <textarea
          value={draft.userComment}
          onChange={(event) =>
            onChange({ ...draft, userComment: event.target.value })
          }
          rows={3}
          className="resize-y border border-rule bg-paper-raised px-3 py-2 text-sm normal-case leading-6 tracking-normal text-ink outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.12em] text-ink-muted">
        Passage
        <textarea
          value={draft.extractedPassage}
          onChange={(event) =>
            onChange({ ...draft, extractedPassage: event.target.value })
          }
          rows={3}
          className="resize-y border border-rule bg-paper-raised px-3 py-2 font-serif text-sm normal-case leading-6 tracking-normal text-ink outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.12em] text-ink-muted">
        Context
        <textarea
          value={draft.extractedContext}
          onChange={(event) =>
            onChange({ ...draft, extractedContext: event.target.value })
          }
          rows={3}
          className="resize-y border border-rule bg-paper-raised px-3 py-2 text-sm normal-case leading-6 tracking-normal text-ink outline-none focus:border-accent"
        />
      </label>

      {error ? (
        <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save edits"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="text-sm text-ink-muted underline decoration-rule underline-offset-4 hover:text-ink disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

export function AnnotationEnrichmentAction({ annotation, isEnriching, onEnrich }: { annotation: Annotation; isEnriching: boolean; onEnrich: (annotationId: string, force?: boolean) => void }) {
  if (isEnriching || annotation.enrichmentStatus === "complete") return null;
  const isRetry = annotation.enrichmentStatus === "failed";
  return <button type="button" onClick={() => onEnrich(annotation.id, isRetry)} className="mt-3 text-xs font-medium text-accent underline decoration-accent/40 underline-offset-4">{isRetry ? "Try extraction again" : "Extract passage"}</button>;
}
