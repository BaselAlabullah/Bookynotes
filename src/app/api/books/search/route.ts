import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/features/auth/auth.session";
import { bookSearchQuerySchema } from "@/features/books/books.schema";
import { searchBooks } from "@/integrations/open-library/open-library.client";
import { OpenLibraryError } from "@/integrations/open-library/open-library.types";

/**
 * Search Open Library. A route handler rather than a Server Function because
 * this is a read that fires as the user types: Server Functions are POSTs and
 * are serialised one at a time per client, which would make search feel laggy.
 *
 * It is authenticated even though it exposes no user data. Otherwise this
 * endpoint is an open proxy that lets anyone spend our Open Library goodwill,
 * and rate limiting by IP would be the next thing we had to build.
 *
 * `getCurrentUser` rather than `requireUser`: a redirect is the wrong answer to
 * a fetch. This returns 401 and lets the caller decide.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = bookSearchQuerySchema.safeParse(
    request.nextUrl.searchParams.get("q"),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query." },
      { status: 400 },
    );
  }

  try {
    const results = await searchBooks(parsed.data);
    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof OpenLibraryError) {
      // 502, not 500: the failure is upstream, and the distinction is what
      // tells us whether to look at our logs or at Open Library's status page.
      return NextResponse.json(
        { error: "Open Library is not responding. Try again in a moment." },
        { status: 502 },
      );
    }

    throw error;
  }
}
