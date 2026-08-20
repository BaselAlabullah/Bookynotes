import { serverEnv } from "@/config/env.server";

import {
  PageProcessorError,
  type RectifiedPage,
} from "./page-processor.types";

/**
 * Calls the page-processor service, if there is one.
 *
 * This is the only optional integration in the app. `PAGE_PROCESSOR_URL` may be
 * unset — on the deployed instance it usually is, because the service runs on a
 * laptop — and then `rectifyPage` returns null and the upload proceeds with the
 * photograph exactly as it arrived. Nothing downstream behaves differently.
 *
 * That is a deliberate property, not a limitation. A feature that only works
 * when an extra process happens to be running must degrade to "the app as it
 * was", or it is not optional at all.
 */

/**
 * Generous, because this is real image processing rather than a lookup: decode,
 * edge detection, a perspective warp over several megapixels, and re-encode.
 * Still bounded, because the upload request is waiting on it.
 */
const TIMEOUT_MS = 45_000;

export const isPageProcessorConfigured = (): boolean =>
  serverEnv.PAGE_PROCESSOR_URL !== undefined;

/**
 * Flatten and clean a page photograph.
 *
 * Returns null when the service is not configured, cannot be reached, or
 * refuses the image. Every one of those is an ordinary outcome — the caller
 * keeps the original photograph and the page is perfectly usable. Only the
 * caller knows whether it is worth mentioning, so nothing is thrown.
 */
export async function rectifyPage(
  image: Buffer,
  contentType: string,
  /**
   * Page corners placed by the reader, as fractions of the image.
   *
   * When given, the service skips detection entirely. That is the better path
   * for the photographs people actually take: a book held open has a curved
   * spine, a thumb over a corner and a page the same colour as the desk, so
   * there is no quadrilateral to find — but a person looking at the picture can
   * place four points in seconds.
   */
  corners?: readonly { x: number; y: number }[],
): Promise<RectifiedPage | null> {
  const baseUrl = serverEnv.PAGE_PROCESSOR_URL;

  if (!baseUrl) {
    return null;
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(image)], { type: contentType }), "page");

  if (corners) {
    // The service takes [x, y] pairs; the app uses {x, y} objects because they
    // read better everywhere else. Converting at the boundary keeps the wire
    // format from leaking inwards.
    form.append(
      "corners",
      JSON.stringify(corners.map((corner) => [corner.x, corner.y])),
    );
  }

  let response: Response;

  try {
    response = await fetch(new URL("/rectify", baseUrl), {
      method: "POST",
      // The secret exists so a process listening on a port cannot be used as
      // free image processing by anything else that can reach it. It is not an
      // authorization decision — see the types file.
      headers: { "X-API-Key": serverEnv.PAGE_PROCESSOR_SECRET ?? "" },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Not running, wrong port, laptop asleep. All the same to us.
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const width = Number(response.headers.get("x-width"));
  const height = Number(response.headers.get("x-height"));

  // The service reports the dimensions so we need not decode the result. If
  // that ever stops being true, decoding a corrupt image later would be a much
  // stranger failure than refusing it here.
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new PageProcessorError(
      "The page processor returned an image without usable dimensions.",
    );
  }

  return {
    image: Buffer.from(await response.arrayBuffer()),
    rectified: response.headers.get("x-rectified") === "true",
    confidence: Number(response.headers.get("x-confidence")) || 0,
    width,
    height,
  };
}
