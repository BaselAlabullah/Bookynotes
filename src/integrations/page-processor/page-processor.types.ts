/**
 * The contract with the page-processor service.
 *
 * Source and destination storage keys go out, and rectified-page metadata comes
 * back. The service holds no user data and makes no authorization decisions:
 * ownership is established before anything reaches it.
 */

export type RectifiedPage = {
  /** True when a page outline was found; false when the original was re-encoded. */
  rectified: boolean;
  /** 0.0 to 1.0. Zero means nothing was detected and nothing was changed. */
  confidence: number;
  /**
   * Dimensions of the written image, reported by the service so the caller
   * does not have to decode it to find out.
   */
  width: number;
  height: number;
  /** Page corners in the source image, clockwise from top-left, when known. */
  corners: number[][] | null;
  /** Whether corners were supplied or detected automatically. */
  source: "manual" | "detected";
};

export class PageProcessorError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "PageProcessorError";
  }
}
