"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/features/auth/auth.session";

import { createAnnotation } from "./annotations.service";
import {
  createAnnotationSchema,
  type CreateAnnotationResult,
} from "./annotations.schema";

/**
 * Create an annotation.
 *
 * Unlike the other Server Functions in this app, this one takes a typed object
 * rather than `FormData` and is called from client code instead of a form's
 * `action`. That gives up progressive enhancement, deliberately: the input is a
 * rectangle dragged with a pointer, so there is no version of this interaction
 * that works without JavaScript to enhance from.
 *
 * The argument still arrives over the wire and is still parsed. A Server
 * Function's parameters are deserialised from a request body, so a TypeScript
 * type on them is a description, not a guarantee.
 *
 * This function does not call the vision model, does not await anything slow,
 * and returns as soon as the row is written. The annotation is born 'pending'
 * and phase 7 enriches it from a separate request.
 */
export async function createAnnotationAction(
  input: unknown,
): Promise<CreateAnnotationResult> {
  const user = await requireUser();

  const parsed = createAnnotationSchema.safeParse(input);

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "That annotation is not valid.",
      createdId: null,
    };
  }

  const annotation = await createAnnotation(user.id, {
    pageId: parsed.data.pageId,
    rect: parsed.data.rect,
    userComment: parsed.data.userComment,
  });

  if (!annotation) {
    // The page does not exist, or is not theirs. The same answer for both.
    return { error: "That page could not be found.", createdId: null };
  }

  // Re-renders the page's server components, so the annotation list picks up
  // the new row without the client keeping its own copy in step.
  revalidatePath("/books", "layout");

  return { error: null, createdId: annotation.id };
}
