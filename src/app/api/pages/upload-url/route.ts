import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/features/auth/auth.session";
import { uploadTargetSchema } from "@/features/pages/pages.schema";
import { prepareUpload } from "@/features/pages/pages.service";
import { StorageError } from "@/integrations/storage/storage.types";

/**
 * Step one of the upload: hand back a URL the browser can PUT to.
 *
 * A route handler rather than a Server Function, by the rule set in DECISIONS
 * 0020: this is a step in a JavaScript-driven flow that needs a JSON answer to
 * decide what to do next, not a form submission.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = uploadTargetSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  try {
    const target = await prepareUpload(user.id, parsed.data);

    if (!target) {
      // Missing book and somebody else's book are the same answer, so nothing
      // can be learned by asking about ids at random.
      return NextResponse.json({ error: "Book not found." }, { status: 404 });
    }

    return NextResponse.json({
      url: target.url,
      token: target.token,
      storageKey: target.storageKey,
    });
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
