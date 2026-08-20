type BookCoverProps = {
  url: string | null;
  title: string;
};

/**
 * A cover image, or a placeholder when Open Library has none.
 *
 * Deliberately a plain <img> and not next/image. Vercel's free tier meters
 * optimised images, and these are already small (about 180px wide), already on
 * a CDN, and never rendered above the fold in bulk. Paying quota to re-optimise
 * a thumbnail somebody else is already serving is a bad trade.
 */
export function BookCover({ url, title }: BookCoverProps) {
  if (!url) {
    return (
      <div
        aria-hidden
        className="flex h-[135px] w-[90px] shrink-0 items-center justify-center rounded border border-ink-muted/20 bg-ink-muted/5 text-xs text-ink-muted"
      >
        No cover
      </div>
    );
  }

  return (
    // next/image is declined on purpose here; the reasoning is in this
    // component's doc comment above.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`Cover of ${title}`}
      width={90}
      height={135}
      loading="lazy"
      className="h-[135px] w-[90px] shrink-0 rounded object-cover"
    />
  );
}
