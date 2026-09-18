import { describe, expect, it } from "bun:test";
import type { CropRect } from "~/core/files/preparation";
import { resolveTargetSize } from "~/core/files/target-size";

const crop: CropRect = { x: 0, y: 0, width: 1600, height: 1200 };

describe("resolveTargetSize", () => {
  it("falls back to the crop's own size", () => {
    const resolved = resolveTargetSize({}, crop);
    expect(resolved).toMatchObject({ width: 1600, height: 1200 });
  });

  it("uses both dimensions when both are given", () => {
    const resolved = resolveTargetSize(
      { targetWidth: 413, targetHeight: 531 },
      crop,
    );
    expect(resolved).toMatchObject({ width: 413, height: 531 });
  });

  it("derives the height from a locked ratio rather than stretching", () => {
    // The old behaviour: a width alone left the other axis at the crop's pixel
    // size, silently distorting the image.
    const resolved = resolveTargetSize(
      { targetWidth: 400, lockedAspectRatio: 0.8 },
      crop,
    );
    expect(resolved).toMatchObject({ width: 400, height: 500 });
    expect(resolved.notes.join(" ")).toContain("Height derived");
  });

  it("derives the width from a locked ratio", () => {
    const resolved = resolveTargetSize(
      { targetHeight: 500, lockedAspectRatio: 0.8 },
      crop,
    );
    expect(resolved).toMatchObject({ width: 400, height: 500 });
  });

  it("falls back to the crop's shape when no ratio is locked", () => {
    // 1600x1200 is 4:3, so a 800px width implies 600px.
    const resolved = resolveTargetSize({ targetWidth: 800 }, crop);
    expect(resolved).toMatchObject({ width: 800, height: 600 });
  });

  it("prefers an explicit lock over the crop's shape", () => {
    const resolved = resolveTargetSize(
      { targetWidth: 800, lockedAspectRatio: 1 },
      crop,
    );
    expect(resolved).toMatchObject({ width: 800, height: 800 });
  });

  it("leaves a ratio inside the allowed range untouched", () => {
    const resolved = resolveTargetSize(
      {
        targetWidth: 400,
        targetHeight: 500,
        aspectRatio: { min: 0.75, max: 0.85 },
      },
      crop,
    );
    expect(resolved).toMatchObject({ width: 400, height: 500 });
    expect(resolved.notes.join(" ")).not.toContain("Adjusted");
  });

  it("shrinks the wide side to reach an allowed ratio", () => {
    const resolved = resolveTargetSize(
      {
        targetWidth: 1000,
        targetHeight: 500,
        aspectRatio: { min: 0.75, max: 0.85 },
      },
      crop,
    );
    expect(resolved.width / resolved.height).toBeCloseTo(0.85, 2);
    expect(resolved.width).toBeLessThan(1000);
    expect(resolved.notes.join(" ")).toContain("aspect ratio");
  });

  it("shrinks the tall side to reach an allowed ratio", () => {
    const resolved = resolveTargetSize(
      {
        targetWidth: 400,
        targetHeight: 2000,
        aspectRatio: { min: 0.75, max: 0.85 },
      },
      crop,
    );
    expect(resolved.width / resolved.height).toBeCloseTo(0.75, 2);
    expect(resolved.height).toBeLessThan(2000);
  });

  it("never upscales to satisfy a ratio", () => {
    // Growing would mean inventing pixels: a rejected upload traded for a
    // blurry one.
    const wide = resolveTargetSize(
      {
        targetWidth: 1000,
        targetHeight: 500,
        aspectRatio: { min: 0.75, max: 0.85 },
      },
      crop,
    );
    expect(wide.width).toBeLessThanOrEqual(1000);
    expect(wide.height).toBeLessThanOrEqual(500);
  });

  it("always returns whole pixels of at least 1", () => {
    const resolved = resolveTargetSize(
      { targetWidth: 0.2, targetHeight: 0.2 },
      crop,
    );
    expect(resolved.width).toBe(1);
    expect(resolved.height).toBe(1);
    expect(Number.isInteger(resolved.width)).toBe(true);
  });

  it("survives a degenerate crop without producing NaN", () => {
    const resolved = resolveTargetSize(
      { targetWidth: 400 },
      { x: 0, y: 0, width: 0, height: 0 },
    );
    expect(Number.isFinite(resolved.width)).toBe(true);
    expect(Number.isFinite(resolved.height)).toBe(true);
    expect(resolved.width).toBe(400);
  });
});
