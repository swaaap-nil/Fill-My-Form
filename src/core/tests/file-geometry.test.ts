import { describe, expect, it } from "bun:test";
import {
  clampRectTo,
  fitWithinRatio,
  rectContains,
  rectsEqual,
  scaleRect,
} from "~/core/files/geometry";
import type { CropRect } from "~/core/files/preparation";

const image: CropRect = { x: 0, y: 0, width: 800, height: 600 };

describe("rectContains", () => {
  it("accepts a selection inside the image", () => {
    expect(rectContains(image, { x: 10, y: 10, width: 100, height: 100 })).toBe(
      true,
    );
  });

  it("accepts a selection flush with every edge", () => {
    expect(rectContains(image, image)).toBe(true);
  });

  it("rejects a selection that escapes any edge", () => {
    // This is the reported bug: the box extends past the image, so the export
    // gets blank strips.
    expect(rectContains(image, { x: -1, y: 0, width: 100, height: 100 })).toBe(
      false,
    );
    expect(rectContains(image, { x: 0, y: -1, width: 100, height: 100 })).toBe(
      false,
    );
    expect(rectContains(image, { x: 750, y: 0, width: 100, height: 100 })).toBe(
      false,
    );
    expect(rectContains(image, { x: 0, y: 550, width: 100, height: 100 })).toBe(
      false,
    );
  });

  it("rejects a selection larger than the image", () => {
    expect(rectContains(image, { x: 0, y: 0, width: 1000, height: 800 })).toBe(
      false,
    );
  });

  it("tolerates sub-pixel slack from getBoundingClientRect", () => {
    // Fractional layout values mean a flush selection often reports a
    // thousandth of a pixel outside. Without tolerance the clamp fights the
    // user at every edge.
    expect(
      rectContains(image, { x: -0.001, y: -0.001, width: 800, height: 600 }),
    ).toBe(true);
  });

  it("honours an explicit epsilon", () => {
    expect(
      rectContains(image, { x: -5, y: 0, width: 100, height: 100 }, 10),
    ).toBe(true);
  });

  it("handles an image not anchored at the origin", () => {
    const offset: CropRect = { x: 100, y: 50, width: 400, height: 300 };
    expect(
      rectContains(offset, { x: 100, y: 50, width: 400, height: 300 }),
    ).toBe(true);
    expect(
      rectContains(offset, { x: 99, y: 50, width: 100, height: 100 }),
    ).toBe(false);
  });
});

describe("clampRectTo", () => {
  it("slides a selection back inside rather than shrinking it", () => {
    // Moving preserves the size the user chose; shrinking would feel like the
    // app fighting the drag.
    expect(
      clampRectTo(image, { x: -50, y: -50, width: 100, height: 100 }),
    ).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(
      clampRectTo(image, { x: 900, y: 700, width: 100, height: 100 }),
    ).toEqual({ x: 700, y: 500, width: 100, height: 100 });
  });

  it("shrinks only when the selection genuinely cannot fit", () => {
    expect(
      clampRectTo(image, { x: 0, y: 0, width: 1200, height: 900 }),
    ).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it("shrinks on one axis and slides on the other", () => {
    expect(
      clampRectTo(image, { x: -20, y: 0, width: 1200, height: 100 }),
    ).toEqual({ x: 0, y: 0, width: 800, height: 100 });
  });

  it("leaves an already-valid selection untouched", () => {
    const valid: CropRect = { x: 10, y: 20, width: 100, height: 200 };
    expect(clampRectTo(image, valid)).toEqual(valid);
  });

  it("always produces a contained rect", () => {
    const wild: readonly CropRect[] = [
      { x: -500, y: -500, width: 2000, height: 2000 },
      { x: 799, y: 599, width: 400, height: 400 },
      { x: -1, y: 300, width: 10, height: 10 },
    ];
    for (const rect of wild) {
      expect(rectContains(image, clampRectTo(image, rect))).toBe(true);
    }
  });

  it("respects an offset image", () => {
    const offset: CropRect = { x: 100, y: 50, width: 400, height: 300 };
    expect(
      clampRectTo(offset, { x: 0, y: 0, width: 100, height: 100 }),
    ).toEqual({ x: 100, y: 50, width: 100, height: 100 });
  });
});

describe("scaleRect", () => {
  it("scales about the centre", () => {
    expect(scaleRect({ x: 100, y: 100, width: 200, height: 200 }, 0.5)).toEqual(
      {
        x: 150,
        y: 150,
        width: 100,
        height: 100,
      },
    );
  });

  it("keeps the centre fixed across a zoom round trip", () => {
    const rect: CropRect = { x: 100, y: 100, width: 200, height: 200 };
    expect(rectsEqual(scaleRect(scaleRect(rect, 1.25), 0.8), rect)).toBe(true);
  });
});

describe("fitWithinRatio", () => {
  it("produces the requested ratio", () => {
    const fitted = fitWithinRatio(
      { x: 0, y: 0, width: 400, height: 400 },
      0.8,
      image,
    );
    expect(fitted.width / fitted.height).toBeCloseTo(0.8, 6);
    expect(rectContains(image, fitted)).toBe(true);
  });

  it("stays inside an image narrower than the requested shape", () => {
    const narrow: CropRect = { x: 0, y: 0, width: 100, height: 800 };
    const fitted = fitWithinRatio(
      { x: 0, y: 0, width: 400, height: 100 },
      4,
      narrow,
    );
    expect(rectContains(narrow, fitted)).toBe(true);
  });

  it("falls back to a clamp for an unusable ratio", () => {
    expect(
      fitWithinRatio({ x: -10, y: 0, width: 100, height: 100 }, 0, image),
    ).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});
