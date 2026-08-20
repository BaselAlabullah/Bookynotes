import type { Metadata } from "next";
import type { ReactNode } from "react";

import { publicEnv } from "@/config/env.public";

import "./globals.css";

export const metadata: Metadata = {
  // metadataBase turns every relative URL in metadata (og:image, canonical
  // links) into an absolute one. It also means the app fails to build if
  // NEXT_PUBLIC_APP_URL is missing, which is the earliest possible warning that
  // auth callbacks would have been broken in production.
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL),
  title: "Bookynotes",
  description: "Annotate photographs of physical book pages and search them.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
