import { describe, expect, it } from "bun:test";
import {
  applyAspectLock,
  clampRatioToRange,
  formatAspectRatio,
  parseAspectRatio,
  ratioOf,
  withinRatioRange,
} from "~/core/files/aspect-ratio";

describe("parseAspectRatio", () => {
  it("accepts the forms a person actually types", () => {
    expect(parseAspectRatio("4:5")).toBeCloseTo(0.8, 6);
    expect(parseAspectRatio("4/5")).toBeCloseTo(0.8, 6);
    expect(parseAspectRatio("4 x 5")).toBeCloseTo(0.8, 6);
    expect(parseAspectRatio("3.5 × 4.5")).toBeCloseTo(3.5 / 4.5, 6);
    expect(parseAspectRatio("  4 : 5  ")).toBeCloseTo(0.8, 6);
  });

  it("still accepts a bare decimal, which is what the old field required", () => {
    expect(parseAspectRatio("0.8")).toBe(0.8);
    expect(parseAspectRatio("3.22")).toBe(3.22);
  });

  it("rejects anything that is not a usable positive ratio", () => {
    for (const input of [
      "",
      "   ",
      "abc",
      "-2",
      "0",
      "0:5",
      "5:0",
      "4:",
      ":5",
      "1:2:3",
      "NaN",
    ]) {
      expect(parseAspectRatio(input)).toBeUndefined();
    }
  });

  it("never divides by zero", () => {
    expect(parseAspectRatio("5:0")).toBeUndefined();
    expect(Number.isFinite(parseAspectRatio("5:0.0001") as number)).toBe(true);
  });
});

describe("formatAspectRatio", () => {
  it("prefers the readable whole-number form", () => {
    expect(formatAspectRatio(0.8)).toBe("4:5");
    expect(formatAspectRatio(1)).toBe("1:1");
    expect(formatAspectRatio(16 / 9)).toBe("16:9");
  });

  it("falls back to a decimal when no small pair fits", () => {
    expect(formatAspectRatio(3.22)).toBe("3.22");
  });

  it("round-trips through parseAspectRatio", () => {
    for (const ratio of [0.8, 1, 16 / 9, 35 / 45]) {
      expect(parseAspectRatio(formatAspectRatio(ratio))).toBeCloseTo(ratio, 4);
    }
  });

  it("returns empty for unusable values", () => {
    expect(formatAspectRatio(0)).toBe("");
    expect(formatAspectRatio(Number.NaN)).toBe("");
  });
});

describe("applyAspectLock", () => {
  it("derives the height when the width is edited", () => {
    expect(applyAspectLock("width", 400, undefined, 0.8)).toEqual({
      width: 400,
      height: 500,
    });
  });

  it("derives the width when the height is edited", () => {
    expect(applyAspectLock("height", undefined, 500, 0.8)).toEqual({
      width: 400,
      height: 500,
    });
  });

  it("leaves the other side alone while a value is half-typed", () => {
    // "" mid-keystroke must not wipe the neighbouring field.
    expect(applyAspectLock("width", undefined, 500, 0.8)).toEqual({
      width: undefined,
      height: 500,
    });
  });

  it("ignores an unusable ratio instead of producing Infinity", () => {
    expect(applyAspectLock("width", 400, 500, 0)).toEqual({
      width: 400,
      height: 500,
    });
    expect(applyAspectLock("width", 400, 500, Number.NaN)).toEqual({
      width: 400,
      height: 500,
    });
  });
});

describe("ratio ranges", () => {
  it("separates a tolerance range from an exact lock", () => {
    expect(withinRatioRange(0.8, { min: 0.75, max: 0.85 })).toBe(true);
    expect(withinRatioRange(0.9, { min: 0.75, max: 0.85 })).toBe(false);
  });

  it("clamps to the nearest in-range value", () => {
    expect(clampRatioToRange(0.9, { min: 0.75, max: 0.85 })).toBe(0.85);
    expect(clampRatioToRange(0.5, { min: 0.75, max: 0.85 })).toBe(0.75);
    expect(clampRatioToRange(0.8, { min: 0.75, max: 0.85 })).toBe(0.8);
  });
});

describe("ratioOf", () => {
  it("returns undefined rather than NaN or Infinity", () => {
    expect(ratioOf(0, 5)).toBeUndefined();
    expect(ratioOf(5, 0)).toBeUndefined();
    expect(ratioOf(Number.NaN, 5)).toBeUndefined();
    expect(ratioOf(400, 500)).toBeCloseTo(0.8, 6);
  });
});
