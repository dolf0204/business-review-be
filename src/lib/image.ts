import sharp from "sharp";

export class ImageError extends Error {
  constructor(public code: "unsupported_image" | "image_too_large") {
    super(code);
  }
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 1600;
const MAX_INPUT_PIXELS = 40_000_000;
const ALLOWED = new Set(["jpeg", "png", "webp"]);

/**
 * Re-encodes an uploaded image. Decoding it proves it really is an image (not a renamed file, not an SVG), and
 * re-encoding drops all metadata, including GPS positions from phone photos, and anything hidden in the original.
 */
export async function processImage(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    const meta = await image.metadata();
    if (!meta.format || !ALLOWED.has(meta.format)) throw new ImageError("unsupported_image");
    const { data, info } = await image
      .rotate() // apply the camera's orientation before the metadata is dropped
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch (e) {
    if (e instanceof ImageError) throw e;
    const message = e instanceof Error ? e.message : "";
    throw new ImageError(/pixel limit|too large/i.test(message) ? "image_too_large" : "unsupported_image");
  }
}
