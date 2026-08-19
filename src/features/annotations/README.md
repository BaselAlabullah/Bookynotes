# features/annotations

A normalized rectangle on a page plus the user's comment, and the passage and
context a vision model extracted from that rectangle.

Two rules define this feature:

- Coordinates are always floats in `0.0..1.0`, relative to the page image's
  intrinsic size. Raw pixels are never stored or passed across a boundary.
- Creating an annotation never waits on the model. The write returns
  immediately with `enrichment_status = 'pending'`; enrichment is a separate
  request that updates the row.

Built in phases 6 and 7.
