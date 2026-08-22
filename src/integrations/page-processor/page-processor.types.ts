/**
 * The contract with the page-processor service.
 *
 * A photograph goes out, and a flattened page with its natural colours comes
 * back. The service holds no user data and makes no authorization decisions —
 * ownership
 * is established before anything reaches it — which is what makes it safe to
 * run somewhere other than production.
 */

export type RectifiedPage = {
  /** The processed image, always JPEG. */
  image: Buffer;
  /** True when a page outline was found; false when the original came back. */
  rectified: boolean;
  /** 0.0 to 1.0. Zero means nothing was detected and nothing was changed. */
  confidence: number;
  /**
   * Dimensions of the returned image, reported by the service so the caller
   * does not have to decode it to find out.
   */
  width: number;
  height: number;
};

export class PageProcessorError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "PageProcessorError";
  }
}
