"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/features/auth/auth.session";

import { deletePageSchema } from "./pages.schema";
import { deletePageAndObjects } from "./pages.service";

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
