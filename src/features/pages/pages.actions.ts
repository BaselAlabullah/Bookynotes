"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/features/auth/auth.session";

import { deletePageSchema, updatePageCornersSchema } from "./pages.schema";
import { deletePageAndObjects, updatePageCorners } from "./pages.service";

export async function deletePageAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = deletePageSchema.safeParse({ pageId: formData.get("pageId") });

  if (!parsed.success) redirect("/library");

  const result = await deletePageAndObjects(user.id, parsed.data.pageId);

  if (result.status === "not-found") redirect("/library");

  const bookPath = `/books/${result.bookId}`;
  revalidatePath(bookPath);
  redirect(result.cleanupIncomplete ? `${bookPath}?cleanup=needed` : bookPath);
}

export type UpdatePageCornersActionResult =
  | { ok: true; cleanupIncomplete: boolean }
  | { ok: false; message: string };

export async function updatePageCornersAction(
  input: unknown,
): Promise<UpdatePageCornersActionResult> {
  const user = await requireUser();
  const parsed = updatePageCornersSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Those page corners are not valid." };
  }

  const result = await updatePageCorners(user.id, parsed.data);

  switch (result.status) {
    case "updated": {
      const bookPath = `/books/${result.page.bookId}`;
      revalidatePath(bookPath);
      revalidatePath(`${bookPath}/pages/${result.page.pageNumber}`);
      return { ok: true, cleanupIncomplete: result.cleanupIncomplete };
    }
    case "not-found":
      return { ok: false, message: "That page could not be found." };
    case "processor-unavailable":
      return {
        ok: false,
        message: "Page straightening is unavailable. Start the page processor and try again.",
      };
    case "source-unreadable":
      return { ok: false, message: "The original photograph could not be read." };
    case "processing-failed":
      return {
        ok: false,
        message: "The page could not be straightened with those corners.",
      };
    case "annotations-cannot-be-remapped":
      return {
        ok: false,
        message:
          "Those corners would move an existing margin note outside the page. Keep the dots around every marked passage and try again.",
      };
    case "update-failed":
      return { ok: false, message: "The updated page could not be saved." };
  }
}
