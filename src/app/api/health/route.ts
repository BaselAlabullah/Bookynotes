import { NextResponse } from "next/server";

/**
 * Liveness probe. Exists so that "is the deployment actually up?" can be
 * answered without loading a page, and so the API layer has one working route
 * before any feature depends on it.
 *
 * GET route handlers are uncached by default in Next 15+, so this reports the
 * live process rather than a value baked in at build time.
 */
export function GET() {
  return NextResponse.json({ status: "ok", time: new Date().toISOString() });
}
