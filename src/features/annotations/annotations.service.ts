import type { UserId } from "@/db/ids";
import { findPage } from "@/features/pages/pages.repository";

import { insertAnnotation } from "./annotations.repository";
import type { Annotation, NewAnnotation } from "./annotations.types";

/**
 * Create an annotation on a page the user owns.
 *
 * Same shape as `pages.service.createPage`, and for the same reason: the
 * repository cannot check a parent it is not allowed to read.
 *
 * This function returns as soon as the row is written. It does not call the
 * vision model, does not await anything slow, and has no idea that enrichment
 * exists — the row leaves here with `enrichment_status = 'pending'` and phase 7
 * picks it up from a separate request.
 */
export async function createAnnotation(
  userId: UserId,
  input: NewAnnotation,
): Promise<Annotation | null> {
  const page = await findPage(userId, input.pageId);

  if (!page) {
    return null;
  }

  return insertAnnotation(userId, input);
}
