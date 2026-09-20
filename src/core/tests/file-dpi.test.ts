import { describe, expect, it } from "bun:test";
import {
  canWriteImageDensity,
  crc32,
  detectImageFormat,
  readImageDensity,
  writeImageDensity,
} from "~/core/files/dpi";

const INCHES_PER_METRE = 39.37007874015748;

const bytes = (...values: number[]) => new Uint8Array(values);

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const u16 = (value: number) => bytes((value >>> 8) & 0xff, value & 0xff);
const u32 = (value: number) =>
  bytes(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );

/** A JPEG with a JFIF APP0 declaring a known density, and nothing else. */
const jpegWithJfif = (density: number, units = 1): Uint8Array =>
  concat(
    bytes(0xff, 0xd8), // SOI
    bytes(0xff, 0xe0), // APP0
    u16(16), // length
    bytes(0x4a, 0x46, 0x49, 0x46, 0x00), // "JFIF\0"
    bytes(1, 1), // version
    bytes(units),
    u16(density),
    u16(density),
    bytes(0, 0), // no thumbnail
    bytes(0xff, 0xd9), // EOI
  );

/** A JPEG carrying no APP0 at all — what a canvas typically produces. */
const jpegWithoutJfif = (): Uint8Array =>
  concat(
    bytes(0xff, 0xd8),
    bytes(0xff, 0xdb), // DQT
    u16(5),
    bytes(0, 1, 2),
    bytes(0xff, 0xd9),
  );

const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = new Uint8Array(
    [...type].map((character) => character.charCodeAt(0)),
  );
  const body = concat(typeBytes, data);
  return concat(u32(data.length), body, u32(crc32(body)));
};

const PNG_SIGNATURE = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const png = (options: { phys?: number } = {}): Uint8Array =>
  concat(
    PNG_SIGNATURE,
    pngChunk("IHDR", new Uint8Array(13)),
    ...(options.phys === undefined
      ? []
      : [
          pngChunk(
            "pHYs",
            concat(
              u32(Math.round(options.phys * INCHES_PER_METRE)),
              u32(Math.round(options.phys * INCHES_PER_METRE)),
              bytes(1),
            ),
          ),
        ]),
    pngChunk("IDAT", bytes(1, 2, 3)),
    pngChunk("IEND", new Uint8Array(0)),
  );

const chunkTypes = (file: Uint8Array): string[] => {
  const types: string[] = [];
  let offset = 8;
  while (offset + 12 <= file.length) {
    const length =
      ((file[offset] as number) << 24) |
      ((file[offset + 1] as number) << 16) |
      ((file[offset + 2] as number) << 8) |
      (file[offset + 3] as number);
    types.push(
      String.fromCharCode(
        file[offset + 4] as number,
        file[offset + 5] as number,
        file[offset + 6] as number,
        file[offset + 7] as number,
      ),
    );
    offset += 12 + length;
  }
  return types;
};

describe("crc32", () => {
  it("matches the known PNG IEND vector", () => {
    // The empty IEND chunk's CRC is a fixed, published value.
    const iend = new Uint8Array([0x49, 0x45, 0x4e, 0x44]);
    expect(crc32(iend)).toBe(0xae426082);
  });

  it("is stable and order-dependent", () => {
    expect(crc32(bytes(1, 2, 3))).toBe(crc32(bytes(1, 2, 3)));
    expect(crc32(bytes(1, 2, 3))).not.toBe(crc32(bytes(3, 2, 1)));
  });

  it("returns an unsigned 32-bit value", () => {
    const value = crc32(bytes(0xff, 0xff, 0xff, 0xff));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("detectImageFormat", () => {
  it("identifies formats by magic bytes, not by a declared type", () => {
    expect(detectImageFormat(jpegWithJfif(300))).toBe("jpeg");
    expect(detectImageFormat(png())).toBe("png");
    expect(
      detectImageFormat(
        concat(
          bytes(0x52, 0x49, 0x46, 0x46),
          u32(0),
          bytes(0x57, 0x45, 0x42, 0x50),
        ),
      ),
    ).toBe("webp");
    expect(detectImageFormat(bytes(1, 2, 3, 4))).toBe("unknown");
  });
});

describe("canWriteImageDensity", () => {
  it("covers JPEG and PNG only", () => {
    expect(canWriteImageDensity("image/jpeg")).toBe(true);
    expect(canWriteImageDensity("image/png")).toBe(true);
  });

  it("excludes WebP, which has no native density field", () => {
    expect(canWriteImageDensity("image/webp")).toBe(false);
    expect(canWriteImageDensity("application/pdf")).toBe(false);
  });
});

describe("reading JPEG density", () => {
  it("reads a JFIF density in inches", () => {
    expect(readImageDensity(jpegWithJfif(300))).toEqual({
      x: 300,
      y: 300,
      source: "jfif",
    });
  });

  it("converts a density declared in centimetres", () => {
    const density = readImageDensity(jpegWithJfif(118, 2));
    expect(density?.x).toBeCloseTo(118 * 2.54, 6);
    expect(density?.source).toBe("jfif");
  });

  it("treats JFIF units 0 as an aspect ratio, not a resolution", () => {
    expect(readImageDensity(jpegWithJfif(1, 0))).toBeUndefined();
  });

  it("returns undefined when the file declares nothing", () => {
    expect(readImageDensity(jpegWithoutJfif())).toBeUndefined();
  });
});

describe("writing JPEG density", () => {
  it("patches an existing JFIF segment in place, without changing length", () => {
    const original = jpegWithJfif(72);
    const patched = writeImageDensity(original, 300);
    expect(patched.length).toBe(original.length);
    expect(readImageDensity(patched)).toEqual({
      x: 300,
      y: 300,
      source: "jfif",
    });
  });

  it("inserts a JFIF segment when the file has none", () => {
    // This is the case that matters most: canvas output carries no APP0, so
    // without insertion a 300 DPI requirement could never be satisfied.
    const original = jpegWithoutJfif();
    const patched = writeImageDensity(original, 300);
    expect(patched.length).toBe(original.length + 18);
    expect(patched[0]).toBe(0xff);
    expect(patched[1]).toBe(0xd8);
    expect(patched[2]).toBe(0xff);
    expect(patched[3]).toBe(0xe0);
    expect(readImageDensity(patched)).toEqual({
      x: 300,
      y: 300,
      source: "jfif",
    });
  });

  it("preserves the segments that were already there", () => {
    const patched = writeImageDensity(jpegWithoutJfif(), 300);
    // The DQT that followed SOI must survive, just shifted along.
    expect(patched[20]).toBe(0xff);
    expect(patched[21]).toBe(0xdb);
  });

  it("round-trips a range of resolutions", () => {
    for (const dpi of [72, 96, 150, 300, 600, 1200]) {
      expect(
        readImageDensity(writeImageDensity(jpegWithJfif(72), dpi))?.x,
      ).toBe(dpi);
    }
  });

  it("normalises a centimetre-based file to inches", () => {
    const patched = writeImageDensity(jpegWithJfif(118, 2), 300);
    expect(readImageDensity(patched)).toEqual({
      x: 300,
      y: 300,
      source: "jfif",
    });
  });
});

describe("PNG density", () => {
  it("reads an existing pHYs chunk", () => {
    const density = readImageDensity(png({ phys: 300 }));
    expect(density?.x).toBeCloseTo(300, 1);
    expect(density?.source).toBe("phys");
  });

  it("returns undefined when there is no pHYs chunk", () => {
    expect(readImageDensity(png())).toBeUndefined();
  });

  it("inserts pHYs before IDAT, as the spec requires", () => {
    const patched = writeImageDensity(png(), 300);
    const types = chunkTypes(patched);
    expect(types).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
    expect(types.indexOf("pHYs")).toBeLessThan(types.indexOf("IDAT"));
  });

  it("grows by exactly one chunk on insertion", () => {
    const original = png();
    expect(writeImageDensity(original, 300).length).toBe(original.length + 21);
  });

  it("overwrites an existing pHYs without changing the file length", () => {
    const original = png({ phys: 72 });
    const patched = writeImageDensity(original, 300);
    expect(patched.length).toBe(original.length);
    expect(readImageDensity(patched)?.x).toBeCloseTo(300, 1);
  });

  it("writes a CRC that independently verifies", () => {
    // A stale CRC makes the file invalid rather than merely wrong, so this is
    // the assertion that matters most for PNG.
    const patched = writeImageDensity(png(), 300);
    let offset = 8;
    let checked = 0;
    while (offset + 12 <= patched.length) {
      const length =
        ((patched[offset] as number) << 24) |
        ((patched[offset + 1] as number) << 16) |
        ((patched[offset + 2] as number) << 8) |
        (patched[offset + 3] as number);
      const stored =
        ((patched[offset + 8 + length] as number) << 24) |
        ((patched[offset + 9 + length] as number) << 16) |
        ((patched[offset + 10 + length] as number) << 8) |
        (patched[offset + 11 + length] as number);
      const computed = crc32(patched.subarray(offset + 4, offset + 8 + length));
      expect(computed >>> 0).toBe(stored >>> 0);
      checked += 1;
      offset += 12 + length;
    }
    expect(checked).toBe(4);
  });

  it("round-trips a range of resolutions", () => {
    for (const dpi of [72, 96, 150, 300, 600]) {
      const density = readImageDensity(writeImageDensity(png(), dpi));
      expect(density?.x).toBeCloseTo(dpi, 0);
    }
  });
});

describe("non-destructive guarantees", () => {
  it("leaves an unsupported format untouched, by identity", () => {
    const webp = concat(
      bytes(0x52, 0x49, 0x46, 0x46),
      u32(0),
      bytes(0x57, 0x45, 0x42, 0x50),
    );
    expect(writeImageDensity(webp, 300)).toBe(webp);
    const junk = bytes(1, 2, 3, 4, 5);
    expect(writeImageDensity(junk, 300)).toBe(junk);
  });

  it("refuses an unusable DPI rather than writing nonsense", () => {
    const original = jpegWithJfif(72);
    for (const dpi of [0, -300, Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      expect(writeImageDensity(original, dpi)).toBe(original);
    }
  });

  it("never mutates its input", () => {
    const original = jpegWithJfif(72);
    const snapshot = new Uint8Array(original);
    writeImageDensity(original, 300);
    expect(original).toEqual(snapshot);
  });

  it("returns undefined and never throws on truncated files", () => {
    const full = jpegWithJfif(300);
    for (let length = 0; length < full.length; length += 1) {
      const truncated = full.subarray(0, length);
      expect(() => readImageDensity(truncated)).not.toThrow();
      expect(() => writeImageDensity(truncated, 300)).not.toThrow();
    }
  });

  it("survives a truncated PNG at every length", () => {
    const full = png({ phys: 300 });
    for (let length = 0; length < full.length; length += 1) {
      const truncated = full.subarray(0, length);
      expect(() => readImageDensity(truncated)).not.toThrow();
      expect(() => writeImageDensity(truncated, 300)).not.toThrow();
    }
  });

  it("survives arbitrary bytes that merely start like an image", () => {
    const seeds = [0xff, 0x89, 0x52];
    for (const seed of seeds) {
      for (let length = 1; length < 64; length += 1) {
        const noise = new Uint8Array(length);
        noise[0] = seed;
        for (let index = 1; index < length; index += 1) {
          noise[index] = (index * 37 + seed) % 256;
        }
        expect(() => readImageDensity(noise)).not.toThrow();
        expect(() => writeImageDensity(noise, 300)).not.toThrow();
      }
    }
  });

  it("handles an empty array", () => {
    const empty = new Uint8Array(0);
    expect(readImageDensity(empty)).toBeUndefined();
    expect(writeImageDensity(empty, 300)).toBe(empty);
  });
});
