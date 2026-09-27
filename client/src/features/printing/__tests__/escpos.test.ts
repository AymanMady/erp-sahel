import { describe, expect, it } from "vitest";

import { escposJob, toBitmap, type Bitmap } from "../escpos";

function bitmap(width: number, height: number, black: (x: number, y: number) => boolean): Bitmap {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) pixels[y * width + x] = black(x, y) ? 1 : 0;
  return { width, height, pixels };
}

describe("ticket printer job", () => {
  it("packs eight dots per byte, leftmost dot first", () => {
    const job = escposJob(bitmap(10, 1, (x) => x === 0 || x === 9));
    // ESC @, then GS v 0 with 2 bytes per row and 1 row.
    expect(Array.from(job.slice(0, 10))).toEqual([0x1b, 0x40, 0x1d, 0x76, 0x30, 0, 2, 0, 1, 0]);
    expect(job[10]).toBe(0b1000_0000);
    expect(job[11]).toBe(0b0100_0000);
  });

  it("splits a long ticket into bands the printer can buffer", () => {
    const job = escposJob(bitmap(8, 300, () => false));
    const bands = [];
    for (let index = 0; index < job.length - 2; index++) {
      if (job[index] === 0x1d && job[index + 1] === 0x76 && job[index + 2] === 0x30) {
        bands.push(job[index + 6] | (job[index + 7] << 8));
      }
    }
    expect(bands).toEqual([128, 128, 44]);
  });

  it("ends with a cut, and opens the drawer only when asked", () => {
    const plain = escposJob(bitmap(8, 1, () => false));
    expect(Array.from(plain.slice(-4))).toEqual([0x1d, 0x56, 66, 0]);
    const withDrawer = escposJob(
      bitmap(8, 1, () => false),
      { openDrawer: true }
    );
    expect(Array.from(withDrawer.slice(-5))).toEqual([0x1b, 0x70, 0, 25, 250]);
  });
});

describe("picture to black and white", () => {
  it("keeps dark ink and drops light or transparent pixels", () => {
    const rgba = new Uint8ClampedArray([
      0,
      0,
      0,
      255, // black
      230,
      230,
      230,
      255, // light grey
      0,
      0,
      0,
      0, // transparent
      60,
      60,
      60,
      255, // dark grey
    ]);
    expect(Array.from(toBitmap(rgba, 4, 1).pixels)).toEqual([1, 0, 0, 1]);
  });
});
