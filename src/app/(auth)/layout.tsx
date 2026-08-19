import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/features/auth/auth.session";

/**
 * Wraps the two credential pages. Signed-in users have no business here, so
 * they are sent to their library rather than shown a sign-in form that would
 * confuse them about whether they are logged in.
 */
export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();

  if (user) {
    redirect("/library");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6">
      {children}
    </main>
  );
}
