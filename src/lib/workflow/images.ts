import sharp from "sharp";
export async function validateProof(bytes: Buffer, mime: string) {
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024)
    throw new Error("Use an image under 5 MB.");
  if (!["image/png", "image/jpeg"].includes(mime))
    throw new Error("Use a PNG or JPEG payment image.");
  try {
    const image = sharp(bytes, {
      limitInputPixels: 20_000_000,
      animated: false,
    });
    const metadata = await image.metadata();
    if (
      !["png", "jpeg"].includes(metadata.format ?? "") ||
      mime !== `image/${metadata.format}` ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error("format");
    const normalized = await image.rotate().png().toBuffer();
    if (normalized.length > 5 * 1024 * 1024) throw new Error("size");
    return normalized;
  } catch {
    throw new Error(
      "This file is not a supported PNG/JPEG image, or is too large. Choose another proof image.",
    );
  }
}
