import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/features/auth/auth.session";
import { completeUploadSchema } from "@/features/pages/pages.schema";
import { completeUpload } from "@/features/pages/pages.service";
import { StorageError } from "@/integrations/storage/storage.types";

/**
 * Step three of the upload: the file is in the bucket, record the page.
 *
 * Every outcome below is an ordinary thing that happens, not an exception, so
 * the service returns a result and this handler maps each one to the status
 * code and the sentence that fits it.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = completeUploadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  try {
    const result = await completeUpload(user.id, parsed.data);

    switch (result.status) {
      case "created":
        revalidatePath(`/books/${parsed.data.bookId}`);
        return NextResponse.json({ page: result.page }, { status: 201 });

      case "not-found":
        return NextResponse.json({ error: "Book not found." }, { status: 404 });

      case "missing-object":
        return NextResponse.json(
          { error: "That upload did not finish. Try again." },
          { status: 409 },
        );

      case "duplicate-page":
        return NextResponse.json(
          {
            error: `Page ${parsed.data.pageNumber} already exists in this book.`,
          },
          { status: 409 },
        );
    }
  } catch (error) {
    if (error instanceof StorageError) {
      return NextResponse.json(
        { error: "Storage is not responding. Try again in a moment." },
        { status: 502 },
      );
    }

    throw error;
  }
}
