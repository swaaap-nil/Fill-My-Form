import { describe, expect, it } from "bun:test";
import type {
  FileInspection,
  PreparedArtifact,
} from "~/core/files/preparation";
import {
  applyPreset,
  effectiveDpi,
  emptyPreparationFormValues,
  explicitDpi,
  type PreparationFormValues,
  preparationFormValuesEqual,
  preparationFormValuesFrom,
  resolveLockedRatio,
  resolvePixelSize,
  resolvePreparationSpec,
  resolvePrepareInput,
  setDimension,
  setLengthUnit,
  snapshotPreparationFormValues,
} from "~/core/files/preparation-form";
import { presetById } from "~/core/files/presets";
import type { FileReference } from "~/core/memory/types";

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

describe("explicitDpi", () => {
  it("never returns the internal default fallback", () => {
    expect(explicitDpi(values(), image)).toBeUndefined();
  });

  it("uses the file header when the field is empty", () => {
    expect(explicitDpi(values(), { ...image, dpi: { x: 200, y: 200 } })).toBe(
      200,
    );
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

  it("sets lockedAspectRatio only when a crop ratio is chosen", () => {
    const unlocked = resolvePreparationSpec(
      values({ aspectRatioInput: "4:5" }),
      image,
    );
    expect(unlocked.spec.lockedAspectRatio).toBeUndefined();

    const locked = resolvePreparationSpec(
      values({ aspectRatioInput: "4:5", lockAspect: true }),
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
    expect(issues.some((issue) => issue.includes("Choose a crop ratio"))).toBe(
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

describe("setDimension", () => {
  it("edits width without changing height", () => {
    const next = setDimension(
      values({ lockAspect: true, aspectRatioInput: "4:5", heightValue: "999" }),
      "width",
      "400",
    );
    expect(next.widthValue).toBe("400");
    expect(next.heightValue).toBe("999");
  });

  it("edits height without changing width", () => {
    const next = setDimension(
      values({ lockAspect: true, aspectRatioInput: "4:5", widthValue: "111" }),
      "height",
      "500",
    );
    expect(next.widthValue).toBe("111");
  });

  it("leaves the other field alone", () => {
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

  it("does not infer crop ratio from final output dimensions", () => {
    expect(
      resolveLockedRatio(values({ widthValue: "400", heightValue: "500" })),
    ).toBeUndefined();
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

describe("preparationFormValuesEqual", () => {
  it("detects a changed output dimension", () => {
    const before = values({ widthValue: "600" });
    const after = values({ widthValue: "100" });
    expect(preparationFormValuesEqual(before, after)).toBe(false);
    expect(
      preparationFormValuesEqual(before, snapshotPreparationFormValues(before)),
    ).toBe(true);
  });
});

describe("resolvePreparationSpec with editor crop", () => {
  it("omits crop from the spec when the crop was applied in the editor", () => {
    const crop = { x: 40, y: 55, width: 490, height: 631 };
    const { spec } = resolvePreparationSpec(
      values({
        crop,
        cropAppliedInEditor: true,
        widthValue: "100",
        heightValue: "120",
      }),
      image,
    );
    expect(spec.crop).toBeUndefined();
    expect(spec.targetWidth).toBe(100);
    expect(spec.targetHeight).toBe(120);
  });

  it("keeps crop on the spec for non-editor crops", () => {
    const crop = { x: 0, y: 0, width: 800, height: 600 };
    const { spec } = resolvePreparationSpec(
      values({ crop, cropAppliedInEditor: false }),
      image,
    );
    expect(spec.crop).toEqual(crop);
  });
});

describe("resolvePrepareInput", () => {
  const original: FileReference = {
    kind: "file_ref",
    id: "original-id",
    name: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1000,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const derived: FileReference = {
    kind: "file_ref",
    id: "derived-id",
    name: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 500,
    createdAt: "2026-01-01T00:00:00.000Z",
    artifactKind: "derived",
    derivedFrom: original.id,
  };
  const baseSpec = resolvePreparationSpec(
    values({ widthValue: "100", heightValue: "120" }),
    image,
  ).spec;

  const prepared = (
    overrides: Partial<PreparedArtifact> = {},
  ): PreparedArtifact => ({
    original,
    derived,
    blob: new Blob(),
    name: derived.name,
    mimeType: derived.mimeType,
    sizeBytes: derived.sizeBytes,
    transformed: true,
    inspection: {
      kind: "image",
      name: derived.name,
      mimeType: derived.mimeType,
      sizeBytes: derived.sizeBytes,
      width: 490,
      height: 631,
    },
    validation: [],
    ...overrides,
  });

  it("uses the original file when no editor crop was applied", () => {
    const result = resolvePrepareInput({
      original,
      prepared: prepared(),
      values: values(),
      spec: baseSpec,
    });
    expect(result.error).toBeUndefined();
    expect(result.input).toBe(original);
    expect(result.spec).toBe(baseSpec);
  });

  it("uses the editor crop draft and strips crop from the spec", () => {
    const crop = { x: 10, y: 20, width: 490, height: 631 };
    const spec = resolvePreparationSpec(
      values({
        crop,
        cropAppliedInEditor: true,
        widthValue: "100",
        heightValue: "120",
      }),
      image,
    ).spec;
    const result = resolvePrepareInput({
      original,
      editorCropDerived: derived,
      values: values({ cropAppliedInEditor: true }),
      spec,
    });
    expect(result.error).toBeUndefined();
    expect(result.input).toBe(derived);
    expect(result.spec.crop).toBeUndefined();
    expect(result.spec.targetWidth).toBe(100);
    expect(result.spec.targetHeight).toBe(120);
  });

  it("re-prepares from the handoff artifact when the editor draft is gone", () => {
    const result = resolvePrepareInput({
      original,
      prepared: prepared(),
      values: values({ cropAppliedInEditor: true }),
      spec: baseSpec,
    });
    expect(result.error).toBeUndefined();
    expect(result.input).toBe(derived);
  });

  it("errors when the editor crop flag is set but the derived copy is missing", () => {
    const result = resolvePrepareInput({
      original,
      values: values({ cropAppliedInEditor: true }),
      spec: baseSpec,
    });
    expect(result.error).toMatch(/apply crop again/i);
  });

  it("errors when the handoff artifact belongs to a different original", () => {
    const otherOriginal: FileReference = { ...original, id: "other-original" };
    const result = resolvePrepareInput({
      original: otherOriginal,
      prepared: prepared(),
      values: values({ cropAppliedInEditor: true }),
      spec: baseSpec,
    });
    expect(result.error).toMatch(/apply crop again/i);
  });
});

describe("preparationFormValuesFrom", () => {
  it("leaves DPI blank so the field stays optional in the UI", () => {
    expect(
      preparationFormValuesFrom({
        ...image,
        dpi: { x: 300, y: 300 },
      }).dpiValue,
    ).toBe("");
    expect(preparationFormValuesFrom(image).dpiValue).toBe("");
  });

  it("defaults image crop ratio to the source image shape", () => {
    const seeded = preparationFormValuesFrom(image);
    expect(seeded.lockAspect).toBe(true);
    expect(seeded.aspectRatioInput).toBe("2880:1864");
  });

  it("does not set a crop ratio for PDFs", () => {
    const seeded = preparationFormValuesFrom({
      kind: "pdf",
      name: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      pageCount: 7,
    });
    expect(seeded.lockAspect).toBe(false);
    expect(seeded.aspectRatioInput).toBe("");
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
