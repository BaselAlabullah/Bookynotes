"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/features/auth/auth.session";

import { createAnnotation, createTextAnnotation } from "./annotations.service";
import {
  createAnnotationSchema,
  createTextAnnotationSchema,
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

/**
 * Create an annotation anchored to a selection in the page transcript.
 *
 * Takes a typed object rather than FormData for the same reason the region
 * version does (DECISIONS 0034): the input is a selection made with a pointer,
 * so there is no form to progressively enhance from.
 *
 * Unlike the region version, nothing is left pending. The reader chose the
 * words, so the passage is known at insert time and no vision call is needed —
 * which on a free tier of twenty calls a day is the difference between a
 * feature you use and one you ration.
 */
export async function createTextAnnotationAction(
  input: unknown,
): Promise<CreateAnnotationResult> {
  const user = await requireUser();

  const parsed = createTextAnnotationSchema.safeParse(input);

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "That selection is not valid.",
      createdId: null,
    };
  }

  const result = await createTextAnnotation(user.id, parsed.data);

  if (result.status === "not-found") {
    return { error: "That page could not be found.", createdId: null };
  }

  if (result.status === "no-transcript") {
    return {
      error: "This page has not been read yet, so there is nothing to select.",
      createdId: null,
    };
  }

  if (result.status === "stale-selection") {
    return {
      error:
        "That selection no longer matches the page text. Reload and try again.",
      createdId: null,
    };
  }

  revalidatePath("/books", "layout");

  return { error: null, createdId: result.annotation.id };
}
