import sharp from "sharp";
import { describe, expect, test } from "vitest";

import { prepareCropForModel } from "./annotations.crop";

describe("prepareCropForModel", () => {
  test("crops in the browser-visible coordinate space of an EXIF-oriented phone photo", async () => {
    // The encoded pixels are landscape, while orientation 6 makes browsers
    // display them as a 60x100 portrait image.
    const phonePhoto = await sharp({
      create: {
        width: 100,
        height: 60,
        channels: 3,
        background: "white",
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const crop = await prepareCropForModel(phonePhoto, {
      x: 0.2,
      y: 0.2,
      width: 0.2,
      height: 0.1,
    });
    const metadata = await sharp(crop.image).metadata();

    // Includes the module's 4% horizontal and 5% vertical context padding.
    // These dimensions are based on the displayed 60x100 image, not the raw
    // 100x60 JPEG pixel matrix.
    expect(metadata.width).toBe(16);
    expect(metadata.height).toBe(20);
    expect(metadata.orientation).toBeUndefined();
  });
});
