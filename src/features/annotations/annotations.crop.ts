import sharp from "sharp";

import type { NormalizedRect } from "./annotations.types";

/**
 * Turns a page photograph and a normalized rectangle into the single image the
 * vision model sees.
 *
 * Four things happen here, and each solves a specific problem with reading a
 * photograph of paper:
 *
 * 1. **Crop, with padding.** Sending the whole page wastes tokens and makes the
 *    model hunt. Sending only the selection removes the surrounding lines that
 *    "context" is supposed to describe. So the crop is the selection plus a
 *    margin.
 * 2. **Mark the selection.** Because the crop is padded, "which part did the
 *    reader mean?" would otherwise be ambiguous. The user's own rectangle is
 *    drawn onto the image, so the model is shown the region rather than told
 *    about it in coordinates it has to resolve itself.
 * 3. **Grayscale and normalise.** A phone photo of a page is unevenly lit, and
 *    normalising stretches the contrast so faint ink separates from paper. This
 *    is the "make it look scanned" step, applied where it actually helps —
 *    to the model's input, not to the pixels we keep.
 * 4. **Downscale.** A 12-megapixel crop costs tokens and buys no legibility
 *    past the point where the letters are sharp.
 *
 * The photograph itself is never modified. Only this derived, throwaway image
 * is, which is what keeps every stored coordinate valid.
 */

/** Extra context around the selection, as a fraction of the page. */
const PAD_X = 0.04;
const PAD_Y = 0.05;

/** Wide enough for small print to stay legible, small enough to stay cheap. */
const MAX_WIDTH = 1400;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export type PreparedCrop = {
  image: Buffer;
  mimeType: string;
};

export async function prepareCropForModel(
  pageImage: Buffer,
  rect: NormalizedRect,
): Promise<PreparedCrop> {
  const metadata = await sharp(pageImage).metadata();

  // The decoder's dimensions, not the ones stored on the page row. Those were
  // reported by the browser at upload time (DECISIONS 0028) and cannot be
  // verified. Because the rectangle is a *fraction*, multiplying by the true
  // decoded size is correct whatever the row claims — so a client that lied
  // about dimensions still gets the right crop.
  const width = metadata.width;
  const height = metadata.height;

  if (!width || !height) {
    throw new Error("That page image could not be decoded.");
  }

  const padded = {
    left: Math.round(clamp(rect.x - PAD_X, 0, 1) * width),
    top: Math.round(clamp(rect.y - PAD_Y, 0, 1) * height),
  };

  const paddedRight = Math.round(clamp(rect.x + rect.width + PAD_X, 0, 1) * width);
  const paddedBottom = Math.round(
    clamp(rect.y + rect.height + PAD_Y, 0, 1) * height,
  );

  // At least one pixel in each direction: sharp rejects a zero-sized extract,
  // and rounding a very thin selection can produce one.
  const paddedWidth = Math.max(1, paddedRight - padded.left);
  const paddedHeight = Math.max(1, paddedBottom - padded.top);

  const scale = Math.min(1, MAX_WIDTH / paddedWidth);
  const outputWidth = Math.max(1, Math.round(paddedWidth * scale));
  const outputHeight = Math.max(1, Math.round(paddedHeight * scale));

  // The selection's position inside the padded crop, after downscaling.
  const marker = {
    x: (rect.x * width - padded.left) * scale,
    y: (rect.y * height - padded.top) * scale,
    width: rect.width * width * scale,
    height: rect.height * height * scale,
  };

  const overlay = Buffer.from(
    `<svg width="${outputWidth}" height="${outputHeight}" xmlns="http://www.w3.org/2000/svg">
       <rect x="${marker.x.toFixed(2)}" y="${marker.y.toFixed(2)}"
             width="${marker.width.toFixed(2)}" height="${marker.height.toFixed(2)}"
             fill="none" stroke="#e11d48" stroke-width="4" />
     </svg>`,
  );

  const image = await sharp(pageImage)
    .extract({
      left: padded.left,
      top: padded.top,
      width: paddedWidth,
      height: paddedHeight,
    })
    .resize({ width: outputWidth, height: outputHeight, fit: "fill" })
    // Grayscale first so normalise stretches one channel of ink-versus-paper
    // rather than three channels of white balance.
    .grayscale()
    .normalise()
    // Composited after the grayscale so the marker keeps its colour and cannot
    // be mistaken for something printed on the page.
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 82 })
    .toBuffer();

  return { image, mimeType: "image/jpeg" };
}
