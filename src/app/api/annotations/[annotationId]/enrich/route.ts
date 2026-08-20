import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { asAnnotationId } from "@/db/ids";
import { enrichAnnotation } from "@/features/annotations/annotations.enrichment";
import { getCurrentUser } from "@/features/auth/auth.session";

/**
 * Run the vision model over one annotation.
 *
 * This is a separate request from creating the annotation, and that separation
 * is the load-bearing part of the design: the write returns immediately with
 * `enrichment_status = 'pending'`, and nothing a slow or rate-limited model does
 * can affect it. If this request never happens, the annotation is still there,
 * still correct, and still retryable.
 */

// Longer than the default: the crop, the upload and the model's own thinking
// add up, and being killed at ten seconds would look like a failure to the user
// while the model was still working.
export const maxDuration = 60;

const paramsSchema = z.object({ annotationId: z.uuid() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ annotationId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = paramsSchema.safeParse(await params);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid annotation." }, { status: 400 });
  }

  // `force` is how the user's own "try again" differs from an automatic run: it
  // is the one case where re-asking a model we already asked is intended.
  const force = request.nextUrl.searchParams.get("force") === "true";

  const outcome = await enrichAnnotation(
    user.id,
    asAnnotationId(parsed.data.annotationId),
    { force },
  );

  switch (outcome.status) {
    case "complete":
    case "cached":
      revalidatePath("/books", "layout");
      return NextResponse.json({
        status: outcome.status,
        annotation: outcome.annotation,
      });

    case "not-found":
      return NextResponse.json(
        { error: "That annotation could not be found." },
        { status: 404 },
      );

    case "retryable":
      revalidatePath("/books", "layout");
      // 503 with Retry-After, because this is the server saying "not now"
      // rather than "never". The client shows the message and keeps the retry
      // button enabled.
      return NextResponse.json(
        { status: outcome.status, error: outcome.message },
        { status: 503, headers: { "Retry-After": "30" } },
      );

    case "failed":
      revalidatePath("/books", "layout");
      return NextResponse.json(
        { status: outcome.status, error: outcome.message },
        { status: 422 },
      );
  }
}
