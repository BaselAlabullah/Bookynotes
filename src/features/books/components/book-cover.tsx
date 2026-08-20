import { ResilientImage } from "@/components/ui/resilient-image";

type BookCoverProps = {
  /**
   * A signed URL for our own stored copy, when there is one, otherwise Open
   * Library's. See `books.cover.ts` for why we keep a copy at all.
   */
  url: string | null;
  storageKey?: string | null;
  title: string;
  /**
   * Set for the covers visible without scrolling.
   *
   * `loading="lazy"` on an image already in the viewport is worse than useless:
   * the browser has to lay the page out before it knows the image is needed, so
   * a cover that was always going to be shown is fetched late. Eager plus a
   * high fetch priority tells it what we already know.
   */
  eager?: boolean;
};

/**
 * A cover image, or a placeholder when there is none.
 *
 * Deliberately a plain <img> and not next/image. Vercel's free tier meters
 * optimised images, and these are already small — about 200px wide, stored by
 * us — so paying quota to re-optimise them is a bad trade.
 *
 * The wrapper is what stops the flash. It occupies the cover's exact size from
 * the first paint, so nothing moves when the image arrives, and it carries the
 * placeholder tint underneath. `color: transparent` on the image hides the alt
 * text *visually* while the bytes are in flight — it is still there for screen
 * readers, but a reader no longer sees "Cover of Empire of Silence" printed in
 * the gap. That was the actual complaint, and it is a rendering artefact rather
 * than a missing image.
 */
export function BookCover({
  url,
  storageKey,
  title,
  eager = false,
}: BookCoverProps) {
  if (!url) {
    return (
      <div
        aria-hidden
        className="flex h-[138px] w-[92px] shrink-0 items-center justify-center border border-rule bg-paper-deep text-xs text-ink-muted shadow-[3px_4px_0_var(--color-rule)]"
      >
        No cover
      </div>
    );
  }

  return (
    <div className="h-[138px] w-[92px] shrink-0 bg-paper-deep shadow-[3px_4px_0_var(--color-rule)]">
      <ResilientImage
        src={url}
        storageKey={storageKey ?? undefined}
        alt={`Cover of ${title}`}
        width={92}
        height={138}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
        className="h-full w-full object-cover text-transparent"
      />
    </div>
  );
}
