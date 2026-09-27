/**
 * ESC/POS commands for ticket printers.
 *
 * The ticket is sent as a **picture** (raster), not as text: the character tables of
 * these printers rarely have Arabic, and never the joined letter forms. A picture
 * prints the same on any ESC/POS printer, in any language, with the shop's own font.
 */

/** Black and white picture, one byte per pixel (1 = black), row by row. */
export interface Bitmap {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Dots across the paper at 203 dpi, printable area. */
export const DOTS_PER_PAPER: Record<58 | 80, number> = { 58: 384, 80: 576 };

const ESC = 0x1b;
const GS = 0x1d;
/**
 * Rows per raster command: some printers have a small receive buffer and drop a
 * whole long ticket sent at once.
 */
const BAND_ROWS = 128;

/** Pixels of an RGBA picture darker than this become black. */
const INK_THRESHOLD = 160;

/** RGBA pixels (a canvas) → black and white. Transparent counts as paper. */
export function toBitmap(rgba: Uint8ClampedArray, width: number, height: number): Bitmap {
  const pixels = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index++) {
    const offset = index * 4;
    const alpha = rgba[offset + 3] / 255;
    // Blend on white paper, then perceived luminance.
    const luminance =
      (0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2]) * alpha +
      255 * (1 - alpha);
    pixels[index] = luminance < INK_THRESHOLD ? 1 : 0;
  }
  return { width, height, pixels };
}

/**
 * Full print job: reset, the picture, paper feed, cut — and the cash drawer when asked.
 */
export function escposJob(bitmap: Bitmap, options: { openDrawer?: boolean } = {}): Uint8Array {
  const bytesPerRow = Math.ceil(bitmap.width / 8);
  const parts: number[][] = [[ESC, 0x40]];

  for (let top = 0; top < bitmap.height; top += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, bitmap.height - top);
    // GS v 0: raster picture, normal size, width in bytes then height in dots.
    const band = [GS, 0x76, 0x30, 0, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8];
    for (let y = top; y < top + rows; y++) {
      for (let byte = 0; byte < bytesPerRow; byte++) {
        let value = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = byte * 8 + bit;
          if (x < bitmap.width && bitmap.pixels[y * bitmap.width + x]) value |= 0x80 >> bit;
        }
        band.push(value);
      }
    }
    parts.push(band);
  }

  // Feed past the cutter, then partial cut.
  parts.push([ESC, 0x64, 4], [GS, 0x56, 66, 0]);
  // Pulse on the drawer connector (pin 2).
  if (options.openDrawer) parts.push([ESC, 0x70, 0, 25, 250]);

  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const job = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    job.set(part, offset);
    offset += part.length;
  }
  return job;
}
