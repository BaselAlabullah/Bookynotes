export type CaptureCheck =
  | { status: "idle" }
  | { status: "checking" }
  | {
      status: "ready";
      width: number;
      height: number;
      megapixels: number;
      warnings: string[];
      tips: string[];
    }
  | { status: "unavailable"; message: string };

export async function inspectCapture(file: File): Promise<Extract<CaptureCheck, { status: "ready" }>> {
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  const sampleSize = 96;
  const canvas = document.createElement("canvas");
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    bitmap.close();
    throw new Error("Could not inspect this image.");
  }

  context.drawImage(bitmap, 0, 0, sampleSize, sampleSize);
  bitmap.close();

  const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
  let brightnessTotal = 0;
  const luminance: number[] = [];

  for (let index = 0; index < pixels.length; index += 4) {
    const gray =
      0.2126 * (pixels[index] ?? 0) +
      0.7152 * (pixels[index + 1] ?? 0) +
      0.0722 * (pixels[index + 2] ?? 0);
    brightnessTotal += gray;
    luminance.push(gray);
  }

  const brightness = brightnessTotal / luminance.length;
  const contrast = Math.sqrt(
    luminance.reduce((total, value) => total + (value - brightness) ** 2, 0) /
      luminance.length,
  );
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const megapixels = (width * height) / 1_000_000;
  const warnings: string[] = [];
  const tips: string[] = [];

  if (shortSide < 900 || megapixels < 1) {
    warnings.push("Low resolution");
    tips.push("Move the camera closer or use the original camera file.");
  }

  if (width > height) {
    warnings.push("Landscape photo");
    tips.push("Portrait pages usually read better when captured upright.");
  }

  if (longSide / shortSide > 2.2) {
    warnings.push("Very narrow crop");
    tips.push("Make sure the whole page is visible, not just a strip of text.");
  }

  if (brightness < 55) {
    warnings.push("Dark image");
    tips.push("Add light or move away from shadows before uploading.");
  } else if (brightness > 220) {
    warnings.push("Very bright image");
    tips.push("Avoid glare; text can disappear in overexposed areas.");
  }

  if (contrast < 28) {
    warnings.push("Low contrast");
    tips.push("Try a darker background or stronger, even lighting.");
  }

  if (file.size > 8 * 1024 * 1024) {
    tips.push("This file is large; upload may be slower on Vercel/Supabase.");
  }

  return {
    status: "ready",
    width,
    height,
    megapixels,
    warnings: Array.from(new Set(warnings)),
    tips: Array.from(new Set(tips)),
  };
}

export async function readImageDimensions(file: File) {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();

  return dimensions;
}
