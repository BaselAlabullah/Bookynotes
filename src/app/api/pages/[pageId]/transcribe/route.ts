import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { asPageId } from "@/db/ids";
import { getCurrentUser } from "@/features/auth/auth.session";
import { transcribePageById } from "@/features/pages/pages.transcription";

/**
 * Read a whole page into text.
 *
 * A separate request from the upload, exactly like annotation enrichment: the
 * page is already saved and usable, and a model that is slow or rate limited
 * must never be able to affect a write that already succeeded.
 */

// The most expensive call this app makes — a whole page up, a page of prose
// back. The default would cut it off mid-transcript.
export const maxDuration = 60;

const paramsSchema = z.object({ pageId: z.uuid() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = paramsSchema.safeParse(await params);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid page." }, { status: 400 });
  }

  const force = request.nextUrl.searchParams.get("force") === "true";

  const outcome = await transcribePageById(
    user.id,
    asPageId(parsed.data.pageId),
    { force },
  );

  switch (outcome.status) {
    case "complete":
    case "cached":
      revalidatePath("/books", "layout");
      return NextResponse.json({ status: outcome.status });

    case "not-found":
      return NextResponse.json(
        { error: "That page could not be found." },
        { status: 404 },
      );

    case "retryable":
      revalidatePath("/books", "layout");
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
