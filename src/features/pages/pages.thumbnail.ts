import sharp from "sharp";

/**
 * A small, cheap version of a page photograph, for grids and filmstrips.
 *
 * The problem this solves, measured before it existed: a twelve-page book grid
 * downloaded 24 MB, because CSS was shrinking 2000x3000 phone photographs into
 * boxes a couple of hundred pixels wide. `width` and `height` attributes change
 * how many pixels are painted, never how many are fetched.
 *
 * Supabase can transform images on the fly, but only on a paid plan. Generating
 * the thumbnail once at upload costs a few hundred milliseconds on a write that
 * already involves an upload, and nothing at all on every subsequent read.
 */

/** Wide enough for a retina filmstrip and a grid tile; small enough to be free. */
const THUMBNAIL_WIDTH = 480;

/**
 * Derived from the original key rather than stored separately, so the two can
 * never point at different pages. `<uuid>.jpg` becomes `<uuid>.thumb.jpg`.
 */
export function thumbnailKeyFor(storageKey: string): string {
  return `${storageKey.replace(/\.[^./]+$/, "")}.thumb.jpg`;
}

export async function buildThumbnail(pageImage: Buffer): Promise<Buffer> {
  return sharp(pageImage)
    .rotate() // honour the EXIF orientation phones write, then drop the tag
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    // Always JPEG, whatever went in: a PNG photograph is an accident, and one
    // output format means one content type to reason about downstream.
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
}
