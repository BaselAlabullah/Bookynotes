import { serverEnv } from "@/config/env.server";

import {
  PageProcessorError,
  type RectifiedPage,
} from "./page-processor.types";

/**
 * Calls the page-processor service, if there is one.
 *
 * This is the only optional integration in the app. `PAGE_PROCESSOR_URL` may be
 * unset, and then `rectifyPage` returns null and the upload proceeds with the
 * photograph exactly as it arrived. Nothing downstream behaves differently.
 */

/**
 * Generous, because this is real image processing rather than a lookup: object
 * download, decode, edge detection, a perspective warp over several megapixels,
 * upload, and JSON metadata back to the caller. Still bounded, because the
 * upload/corner-edit request is waiting on it.
 */
const TIMEOUT_MS = 45_000;

export const isPageProcessorConfigured = (): boolean =>
  serverEnv.PAGE_PROCESSOR_URL !== undefined;

/**
 * Flatten and clean a page photograph.
 *
 * Returns null when the service is not configured, cannot be reached, or
 * refuses the image. Every one of those is an ordinary outcome: the caller keeps
 * the original photograph and the page is perfectly usable. Only the caller
 * knows whether it is worth mentioning, so nothing is thrown.
 */
export async function rectifyPage(
  sourceKey: string,
  destinationKey: string,
  /**
   * Page corners placed by the reader, as fractions of the image.
   *
   * When given, the service skips detection entirely. That is the better path
   * for the photographs people actually take: a book held open has a curved
   * spine, a thumb over a corner and a page the same colour as the desk, so
   * there is no quadrilateral to find, but a person looking at the picture can
   * place four points in seconds.
   */
  corners?: readonly { x: number; y: number }[],
): Promise<RectifiedPage | null> {
  const baseUrl = serverEnv.PAGE_PROCESSOR_URL;

  if (!baseUrl) {
    return null;
  }

  let response: Response;

  try {
    response = await fetch(processorEndpoint(baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The secret exists so a process listening on a port cannot be used as
        // free image processing by anything else that can reach it. It is not
        // an authorization decision; see the types file.
        "X-API-Key": serverEnv.PAGE_PROCESSOR_SECRET ?? "",
      },
      body: JSON.stringify({
        sourceKey,
        destinationKey,
        corners: corners
          ? corners.map((corner) => [corner.x, corner.y])
          : null,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Not running, wrong port, laptop asleep. All the same to us.
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  const parsed = parseRectifiedPage(payload);

  if (!parsed) {
    throw new PageProcessorError(
      "The page processor returned metadata without usable dimensions.",
    );
  }

  return parsed;
}

function processorEndpoint(baseUrl: string): URL {
  return new URL("rectify", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

function parseRectifiedPage(payload: unknown): RectifiedPage | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const value = payload as Record<string, unknown>;
  const width = value.width;
  const height = value.height;
  const source = value.source;

  if (
    typeof value.rectified !== "boolean" ||
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    (source !== "manual" && source !== "detected") ||
    !isCorners(value.corners)
  ) {
    return null;
  }

  return {
    rectified: value.rectified,
    confidence: value.confidence,
    width,
    height,
    corners: value.corners,
    source,
  };
}

function isCorners(value: unknown): value is number[][] | null {
  return (
    value === null ||
    (Array.isArray(value) &&
      value.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every((coordinate) => typeof coordinate === "number"),
      ))
  );
}
