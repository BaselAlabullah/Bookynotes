import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { asPageId } from "@/db/ids";
import { getCurrentUser } from "@/features/auth/auth.session";
import { savePageTranscriptSchema } from "@/features/pages/pages.schema";
import { savePageTranscriptById } from "@/features/pages/pages.transcription";

const paramsSchema = z.object({ pageId: z.uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ pageId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsedParams = paramsSchema.safeParse(await params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid page." }, { status: 400 });
  }

  const parsedBody = savePageTranscriptSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Transcript text is required." },
      { status: 400 },
    );
  }

  const outcome = await savePageTranscriptById(
    user.id,
    asPageId(parsedParams.data.pageId),
    parsedBody.data,
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
    case "failed":
      return NextResponse.json(
        { error: outcome.message },
        { status: outcome.status === "failed" ? 422 : 503 },
      );
  }
}
