import { describe, expect, it } from "bun:test";
import type { FileInspection } from "~/core/files/preparation";
import {
  applyPreset,
  effectiveDpi,
  emptyPreparationFormValues,
  type PreparationFormValues,
  preparationFormValuesFrom,
  resolveLockedRatio,
  resolvePixelSize,
  resolvePreparationSpec,
  setDimension,
  setLengthUnit,
} from "~/core/files/preparation-form";
import { presetById } from "~/core/files/presets";

const image: FileInspection = {
  kind: "image",
  name: "photo.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 9_827_000,
  width: 2880,
  height: 1864,
};

const values = (
  overrides: Partial<PreparationFormValues> = {},
): PreparationFormValues => ({ ...emptyPreparationFormValues, ...overrides });

describe("effectiveDpi", () => {
  it("prefers the user's target over the file's own", () => {
    expect(
      effectiveDpi(values({ dpiValue: "300" }), {
        ...image,
        dpi: { x: 72, y: 72 },
      }),
    ).toBe(300);
  });

  it("falls back to the file's declared DPI", () => {
    expect(effectiveDpi(values(), { ...image, dpi: { x: 200, y: 200 } })).toBe(
      200,
    );
  });

  it("falls back to the CSS reference pixel when nothing declares one", () => {
    expect(effectiveDpi(values(), image)).toBe(96);
  });

  it("ignores junk in the DPI field", () => {
    expect(effectiveDpi(values({ dpiValue: "abc" }), image)).toBe(96);
    expect(effectiveDpi(values({ dpiValue: "0" }), image)).toBe(96);
  });
});

describe("resolvePixelSize", () => {
  it("converts the passport case the roadmap names", () => {
    const size = resolvePixelSize(
      values({
        widthValue: "35",
        heightValue: "45",
        lengthUnit: "mm",
        dpiValue: "300",
      }),
      image,
    );
    expect(size).toEqual({ width: 413, height: 531 });
  });

  it("passes pixels through unchanged", () => {
    expect(
      resolvePixelSize(
        values({ widthValue: "600", heightValue: "600" }),
        image,
      ),
    ).toEqual({ width: 600, height: 600 });
  });

  it("leaves a blank field undefined rather than zero", () => {
    expect(resolvePixelSize(values({ widthValue: "600" }), image)).toEqual({
      width: 600,
      height: undefined,
    });
  });
});

describe("resolvePreparationSpec", () => {
  it("converts a KB limit to binary bytes", () => {
    const { spec } = resolvePreparationSpec(
      values({ maxSizeValue: "100", maxSizeUnit: "KB" }),
      image,
    );
    expect(spec.maxBytes).toBe(102400);
  });

  it("supports an MB limit, which the old KB-only field could not express", () => {
    const { spec } = resolvePreparationSpec(
      values({ maxSizeValue: "2", maxSizeUnit: "MB" }),
      image,
    );
    expect(spec.maxBytes).toBe(2097152);
  });

  it("maps 'keep' to no format override", () => {
    const { spec } = resolvePreparationSpec(values({ format: "keep" }), image);
    expect(spec.outputMimeType).toBeUndefined();
  });

  it("passes an explicit target format through", () => {
    const { spec } = resolvePreparationSpec(
      values({ format: "image/png" }),
      image,
    );
    expect(spec.outputMimeType).toBe("image/png");
  });

  it("sets lockedAspectRatio only when the lock is on", () => {
    const unlocked = resolvePreparationSpec(
      values({ widthValue: "400", heightValue: "500" }),
      image,
    );
    expect(unlocked.spec.lockedAspectRatio).toBeUndefined();

    const locked = resolvePreparationSpec(
      values({ widthValue: "400", heightValue: "500", lockAspect: true }),
      image,
    );
    expect(locked.spec.lockedAspectRatio).toBeCloseTo(0.8, 6);
  });

  it("allows downscaling by default, the only lever PNG has", () => {
    const { spec } = resolvePreparationSpec(values(), image);
    expect(spec.allowDownscale).toBe(true);
  });

  it("reports contradictory size bounds instead of throwing", () => {
    const { issues } = resolvePreparationSpec(
      values({
        minSizeValue: "2",
        minSizeUnit: "MB",
        maxSizeValue: "100",
        maxSizeUnit: "KB",
      }),
      image,
    );
    expect(
      issues.some((issue) => issue.includes("larger than the maximum")),
    ).toBe(true);
  });

  it("warns when a physical unit is converted at an assumed DPI", () => {
    const { issues } = resolvePreparationSpec(
      values({ widthValue: "35", lengthUnit: "mm" }),
      image,
    );
    expect(issues.some((issue) => issue.includes("declares no DPI"))).toBe(
      true,
    );
  });

  it("stays quiet when the file declares its own DPI", () => {
    const { issues } = resolvePreparationSpec(
      values({ widthValue: "35", lengthUnit: "mm" }),
      { ...image, dpi: { x: 300, y: 300 } },
    );
    expect(issues.some((issue) => issue.includes("declares no DPI"))).toBe(
      false,
    );
  });

  it("asks for something to lock to when the lock has no ratio", () => {
    const { issues } = resolvePreparationSpec(
      values({ lockAspect: true }),
      image,
    );
    expect(issues.some((issue) => issue.includes("for the lock to hold"))).toBe(
      true,
    );
  });

  it("does not build a page range for an image", () => {
    const { spec } = resolvePreparationSpec(values(), image);
    expect(spec.pageRange).toBeUndefined();
  });

  it("builds a page range for a PDF and catches an inverted one", () => {
    const pdf: FileInspection = {
      kind: "pdf",
      name: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000,
      pageCount: 10,
    };
    const { spec, issues } = resolvePreparationSpec(
      values({ pageStart: "5", pageEnd: "2" }),
      pdf,
    );
    expect(spec.pageRange).toEqual({ start: 5, end: 2 });
    expect(issues.some((issue) => issue.includes("after the last page"))).toBe(
      true,
    );
  });

  it("never throws on half-typed input", () => {
    const partial = values({
      widthValue: "3",
      heightValue: "",
      aspectRatioInput: "4:",
      maxSizeValue: "-",
      dpiValue: "3o0",
      lockAspect: true,
    });
    expect(() => resolvePreparationSpec(partial, image)).not.toThrow();
  });
});

describe("setDimension with the aspect lock", () => {
  it("derives the height from an edited width", () => {
    const next = setDimension(
      values({ lockAspect: true, aspectRatioInput: "4:5" }),
      "width",
      "400",
    );
    expect(next.widthValue).toBe("400");
    expect(next.heightValue).toBe("500");
  });

  it("derives the width from an edited height", () => {
    const next = setDimension(
      values({ lockAspect: true, aspectRatioInput: "4:5" }),
      "height",
      "500",
    );
    expect(next.widthValue).toBe("400");
  });

  it("leaves the other field alone when the lock is off", () => {
    const next = setDimension(values({ heightValue: "999" }), "width", "400");
    expect(next.heightValue).toBe("999");
  });

  it("does not wipe the neighbour while a value is being cleared", () => {
    const next = setDimension(
      values({ lockAspect: true, aspectRatioInput: "4:5", heightValue: "500" }),
      "width",
      "",
    );
    expect(next.heightValue).toBe("500");
  });

  it("drops back to Custom once a dimension is hand-edited", () => {
    const next = setDimension(values({ presetId: "passport" }), "width", "400");
    expect(next.presetId).toBe("custom");
  });
});

describe("setLengthUnit", () => {
  it("converts the numbers rather than reinterpreting them", () => {
    // 35 mm must become 1.38 in, not 35 in.
    const next = setLengthUnit(
      values({ widthValue: "35", lengthUnit: "mm", dpiValue: "300" }),
      "in",
      image,
    );
    expect(Number(next.widthValue)).toBeCloseTo(1.38, 2);
  });

  it("is a no-op for the unit already selected", () => {
    const current = values({ widthValue: "35", lengthUnit: "mm" });
    expect(setLengthUnit(current, "mm", image)).toBe(current);
  });

  it("leaves a blank field blank", () => {
    const next = setLengthUnit(values({ lengthUnit: "px" }), "mm", image);
    expect(next.widthValue).toBe("");
  });

  it("survives a round trip without drift", () => {
    const start = values({
      widthValue: "600",
      lengthUnit: "px",
      dpiValue: "300",
    });
    const round = setLengthUnit(setLengthUnit(start, "mm", image), "px", image);
    expect(Number(round.widthValue)).toBe(600);
  });
});

describe("presets", () => {
  it("applies dimensions, unit, DPI and size together", () => {
    const passport = presetById("passport");
    expect(passport).toBeDefined();
    const next = applyPreset(
      values(),
      passport as NonNullable<typeof passport>,
    );
    expect(next.widthValue).toBe("35");
    expect(next.heightValue).toBe("45");
    expect(next.lengthUnit).toBe("mm");
    expect(next.dpiValue).toBe("300");
    expect(next.lockAspect).toBe(true);
    // The old implementation never touched the size limit, leaving a stale
    // one behind.
    expect(next.maxSizeValue).toBe("200");
    expect(next.maxSizeUnit).toBe("KB");
  });

  it("resolves to the pixel size the preset implies", () => {
    const passport = presetById("passport");
    const next = applyPreset(
      values(),
      passport as NonNullable<typeof passport>,
    );
    expect(resolvePixelSize(next, image)).toEqual({ width: 413, height: 531 });
  });

  it("leaves everything alone for Custom", () => {
    const custom = presetById("custom");
    const current = values({ widthValue: "123", heightValue: "456" });
    const next = applyPreset(current, custom as NonNullable<typeof custom>);
    expect(next.widthValue).toBe("123");
    expect(next.heightValue).toBe("456");
  });

  it("names no particular site, per the fixture-generalisation rule", () => {
    const banned = /ibps|aai|supabase|passport seva|upsc|ssc\b/i;
    for (const preset of [presetById("passport"), presetById("photograph")]) {
      expect(banned.test(preset?.label ?? "")).toBe(false);
      expect(banned.test(preset?.id ?? "")).toBe(false);
    }
  });
});

describe("resolveLockedRatio", () => {
  it("prefers an explicitly typed ratio", () => {
    expect(
      resolveLockedRatio(
        values({
          aspectRatioInput: "1:1",
          widthValue: "400",
          heightValue: "500",
        }),
      ),
    ).toBe(1);
  });

  it("falls back to the current dimensions", () => {
    expect(
      resolveLockedRatio(values({ widthValue: "400", heightValue: "500" })),
    ).toBeCloseTo(0.8, 6);
  });

  it("falls back to the crop selection's shape", () => {
    expect(
      resolveLockedRatio(
        values({ crop: { x: 0, y: 0, width: 200, height: 100 } }),
      ),
    ).toBeCloseTo(2, 6);
  });

  it("is undefined when there is nothing to infer from", () => {
    expect(resolveLockedRatio(values())).toBeUndefined();
  });
});

describe("preparationFormValuesFrom", () => {
  it("seeds the DPI field from the file's own header", () => {
    const seeded = preparationFormValuesFrom({
      ...image,
      dpi: { x: 300, y: 300 },
    });
    expect(seeded.dpiValue).toBe("300");
  });

  it("leaves DPI blank when the file declares none", () => {
    expect(preparationFormValuesFrom(image).dpiValue).toBe("");
  });

  it("seeds the last page from the page count", () => {
    const seeded = preparationFormValuesFrom({
      kind: "pdf",
      name: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      pageCount: 7,
    });
    expect(seeded.pageEnd).toBe("7");
  });
});
