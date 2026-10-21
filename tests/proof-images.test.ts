import { it, expect } from "vitest";
import sharp from "sharp";
import { validateProof } from "../src/lib/workflow/images";
it("validates actual PNG/JPEG bytes and strips metadata", async () => {
  const image = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#ffffff" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const normalized = await validateProof(image, "image/jpeg");
  const metadata = await sharp(normalized).metadata();
  expect(metadata.format).toBe("png");
  expect(metadata.exif).toBeUndefined();
  await expect(validateProof(image, "image/png")).rejects.toThrow("supported");
  await expect(
    validateProof(Buffer.from("<script>bad</script>"), "image/png"),
  ).rejects.toThrow("supported");
  await expect(
    validateProof(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png"),
  ).rejects.toThrow("5 MB");
});
