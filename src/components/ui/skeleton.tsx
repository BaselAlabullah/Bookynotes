/**
 * A placeholder block, used by the route-level loading files.
 *
 * Deliberately a static tint rather than a shimmer. A shimmering gradient is
 * the house style of every AI-generated dashboard, it animates something the
 * user cannot act on, and it is exactly the sort of motion
 * `prefers-reduced-motion` exists to suppress. A quiet block reads as "not yet"
 * without performing it.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`rounded-[2px] bg-ink/[0.055] dark:bg-paper/[0.07] ${className}`}
    />
  );
}
