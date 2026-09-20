import { describe, expect, it } from "bun:test";
import {
  BYTE_UNITS,
  formatBytes,
  formatInUnit,
  fromBytes,
  pickByteUnit,
  toBytes,
} from "~/core/files/byte-units";
import {
  convertLength,
  DEFAULT_DPI,
  formatLength,
  fromPixels,
  LENGTH_UNITS,
  type LengthUnit,
  toPixels,
  toPixelsRounded,
} from "~/core/files/units";

describe("length units", () => {
  it("converts physical units at the given DPI", () => {
    expect(toPixels(1, "in", 300)).toBe(300);
    expect(toPixels(2.54, "cm", 300)).toBeCloseTo(300, 6);
    expect(toPixels(25.4, "mm", 300)).toBeCloseTo(300, 6);
    expect(toPixels(500, "px", 300)).toBe(500);
  });

  it("resolves the passport-photo case the roadmap names", () => {
    // 35 x 45 mm at 300 DPI is the requirement docs/roadmap/phase-7-files.md
    // states as the goal, so it is the case worth pinning exactly.
    expect(toPixelsRounded(35, "mm", 300)).toBe(413);
    expect(toPixelsRounded(45, "mm", 300)).toBe(531);
  });

  it("scales with DPI rather than assuming one", () => {
    expect(toPixelsRounded(1, "in", 72)).toBe(72);
    expect(toPixelsRounded(1, "in", 96)).toBe(96);
    expect(toPixelsRounded(1, "in", 300)).toBe(300);
  });

  it("falls back to the CSS reference pixel for an unusable DPI", () => {
    for (const dpi of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(toPixels(1, "in", dpi)).toBe(DEFAULT_DPI);
    }
  });

  it("never rounds a dimension down to zero", () => {
    expect(toPixelsRounded(0.001, "mm", 72)).toBe(1);
  });

  it("round-trips every unit pair", () => {
    for (const from of LENGTH_UNITS) {
      for (const to of LENGTH_UNITS) {
        for (const dpi of [72, 96, 300]) {
          const back = convertLength(
            convertLength(10, from, to, dpi),
            to,
            from,
            dpi,
          );
          expect(back).toBeCloseTo(10, 6);
        }
      }
    }
  });

  it("inverts toPixels exactly", () => {
    for (const unit of LENGTH_UNITS) {
      expect(fromPixels(toPixels(7, unit, 300), unit, 300)).toBeCloseTo(7, 6);
    }
  });

  it("formats without floating-point noise", () => {
    // The reason formatLength exists: a naive round trip shows 45.000000000000006.
    const noisy = convertLength(
      convertLength(45, "mm", "in", 300),
      "in",
      "mm",
      300,
    );
    expect(formatLength(noisy, "mm")).toBe("45");
    expect(formatLength(413, "px")).toBe("413");
    expect(formatLength(1.3779, "in")).toBe("1.38");
    expect(formatLength(Number.NaN, "px")).toBe("");
  });

  it("keeps pixels whole and physical units fractional", () => {
    expect(formatLength(45.6, "px")).toBe("46");
    expect(formatLength(45.64, "mm")).toBe("45.6");
  });
});

describe("byte units", () => {
  it("is binary, because portals mean 102400 when they say 100 KB", () => {
    expect(toBytes(100, "KB")).toBe(102400);
    expect(toBytes(1, "MB")).toBe(1048576);
    expect(toBytes(512, "B")).toBe(512);
  });

  it("round-trips every unit", () => {
    for (const unit of BYTE_UNITS) {
      expect(fromBytes(toBytes(3, unit), unit)).toBe(3);
    }
  });

  it("picks the unit a size reads best in", () => {
    expect(pickByteUnit(512)).toBe("B");
    expect(pickByteUnit(102400)).toBe("KB");
    expect(pickByteUnit(5 * 1024 * 1024)).toBe("MB");
    expect(pickByteUnit(1048575)).toBe("KB");
  });

  it("formats sizes the way the panel shows them", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(102400)).toBe("100 KB");
    expect(formatBytes(9.37 * 1024 * 1024)).toBe("9.37 MB");
  });

  it("returns empty rather than NaN for unusable input", () => {
    expect(formatBytes(Number.NaN)).toBe("");
    expect(formatBytes(-1)).toBe("");
    expect(formatInUnit(Number.NaN, "KB")).toBe("");
  });

  it("prefills an input in a chosen unit", () => {
    expect(formatInUnit(102400, "KB")).toBe("100");
    expect(formatInUnit(1572864, "MB")).toBe("1.5");
  });
});

describe("unit type guards", () => {
  it("accepts only known units", () => {
    const units: readonly string[] = ["px", "in", "cm", "mm"];
    for (const unit of units) {
      expect(LENGTH_UNITS.includes(unit as LengthUnit)).toBe(true);
    }
  });
});
