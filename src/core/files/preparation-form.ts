/**
 * The bridge between what the user typed and what an adapter executes.
 *
 * Every field arrives as a string, because that is what an `<input>` holds
 * mid-keystroke: `"3"` on the way to `"35"`, `""` when cleared, `"4:"` on the
 * way to `"4:5"`. Coercion, unit conversion and crop-ratio parsing all happen
 * here rather than in a component, so the rules are unit-tested without a DOM
 * and shared verbatim by the side panel and the editor window.
 *
 * `resolvePreparationSpec` never throws and never rejects input. A half-typed
 * value simply does not contribute to the spec, and anything genuinely
 * contradictory comes back in `issues` for the UI to show. A form that
 * argues with you while you are still typing is worse than one that waits.
 */

import type { FileReference } from "../memory/types";
import { parseAspectRatio, ratioOf } from "./aspect-ratio";
import {
  type ByteUnit,
  formatInUnit,
  pickByteUnit,
  toBytes,
} from "./byte-units";
import type {
  CropRect,
  FileInspection,
  PreparationSpec,
  PreparedArtifact,
} from "./preparation";
import { CUSTOM_PRESET_ID, type PreparationPreset } from "./presets";
import {
  DEFAULT_DPI,
  formatLength,
  fromPixels,
  type LengthUnit,
  toPixelsRounded,
} from "./units";

/** `"keep"` means "whatever the source already is" — not a missing choice. */
export type OutputFormat = "keep" | "image/jpeg" | "image/png" | "image/webp";

export interface PreparationFormValues {
  readonly presetId: string;
  readonly widthValue: string;
  readonly heightValue: string;
  readonly lengthUnit: LengthUnit;
  readonly lockAspect: boolean;
  readonly aspectRatioInput: string;
  readonly maxSizeValue: string;
  readonly maxSizeUnit: ByteUnit;
  readonly minSizeValue: string;
  readonly minSizeUnit: ByteUnit;
  readonly format: OutputFormat;
  readonly dpiValue: string;
  readonly crop?: CropRect;
  /**
   * Set when the user applied a crop in the image editor. The crop rectangle in
   * `crop` is in cropper canvas space and must not be passed to `prepare()` on
   * the original file — only the derived artifact carries the cropped pixels.
   */
  readonly cropAppliedInEditor?: boolean;
  readonly rotationDegrees?: number;
  readonly flipHorizontal?: boolean;
  readonly flipVertical?: boolean;
  readonly pageStart: string;
  readonly pageEnd: string;
  readonly pageWidth: string;
  readonly pageHeight: string;
}

/** Immutable snapshot for comparing whether step 3 changed after a prepare. */
export const snapshotPreparationFormValues = (
  values: PreparationFormValues,
): PreparationFormValues => ({
  ...values,
  crop: values.crop ? { ...values.crop } : undefined,
});

const cropRectsEqual = (
  a: CropRect | undefined,
  b: CropRect | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
};

export const preparationFormValuesEqual = (
  a: PreparationFormValues,
  b: PreparationFormValues,
): boolean =>
  a.presetId === b.presetId &&
  a.widthValue === b.widthValue &&
  a.heightValue === b.heightValue &&
  a.lengthUnit === b.lengthUnit &&
  a.lockAspect === b.lockAspect &&
  a.aspectRatioInput === b.aspectRatioInput &&
  a.maxSizeValue === b.maxSizeValue &&
  a.maxSizeUnit === b.maxSizeUnit &&
  a.minSizeValue === b.minSizeValue &&
  a.minSizeUnit === b.minSizeUnit &&
  a.format === b.format &&
  a.dpiValue === b.dpiValue &&
  a.cropAppliedInEditor === b.cropAppliedInEditor &&
  a.rotationDegrees === b.rotationDegrees &&
  a.flipHorizontal === b.flipHorizontal &&
  a.flipVertical === b.flipVertical &&
  a.pageStart === b.pageStart &&
  a.pageEnd === b.pageEnd &&
  a.pageWidth === b.pageWidth &&
  a.pageHeight === b.pageHeight &&
  cropRectsEqual(a.crop, b.crop);

export const emptyPreparationFormValues: PreparationFormValues = {
  presetId: CUSTOM_PRESET_ID,
  widthValue: "",
  heightValue: "",
  lengthUnit: "px",
  lockAspect: false,
  aspectRatioInput: "",
  maxSizeValue: "",
  maxSizeUnit: "KB",
  minSizeValue: "",
  minSizeUnit: "KB",
  format: "keep",
  dpiValue: "",
  pageStart: "1",
  pageEnd: "",
  pageWidth: "",
  pageHeight: "",
  cropAppliedInEditor: false,
};

const numberOrUndefined = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/**
 * The DPI every physical-unit conversion in this module runs at, in priority
 * order: what the user asked for, else what the source file declares, else
 * the CSS reference pixel. Exported because the UI needs the same number to
 * render "35 mm = 413 px" next to the field.
 */
export const effectiveDpi = (
  values: PreparationFormValues,
  inspection?: FileInspection,
): number =>
  numberOrUndefined(values.dpiValue) ?? inspection?.dpi?.x ?? DEFAULT_DPI;

/** DPI the UI may cite — user target or file header, never the internal default. */
export const explicitDpi = (
  values: PreparationFormValues,
  inspection?: FileInspection,
): number | undefined =>
  numberOrUndefined(values.dpiValue) ?? inspection?.dpi?.x;

/** Seeds the form from a freshly inspected file. */
export const preparationFormValuesFrom = (
  inspection: FileInspection,
): PreparationFormValues => {
  const sourceRatio =
    inspection.width && inspection.height
      ? `${inspection.width}:${inspection.height}`
      : "";
  return {
    ...emptyPreparationFormValues,
    lockAspect: Boolean(sourceRatio),
    aspectRatioInput: sourceRatio,
    dpiValue: "",
    pageEnd: inspection.pageCount ? `${inspection.pageCount}` : "",
  };
};

/**
 * Applies a preset without discarding what the preset does not mention.
 * The old implementation overwrote width, height and ratio unconditionally
 * and never touched the size limit, so picking a preset silently wiped
 * custom dimensions while leaving a stale limit behind.
 */
export const applyPreset = (
  values: PreparationFormValues,
  preset: PreparationPreset,
): PreparationFormValues => {
  if (preset.id === CUSTOM_PRESET_ID) {
    return { ...values, presetId: preset.id };
  }
  return {
    ...values,
    presetId: preset.id,
    widthValue: preset.width === undefined ? "" : `${preset.width}`,
    heightValue: preset.height === undefined ? "" : `${preset.height}`,
    lengthUnit: preset.unit,
    dpiValue: preset.dpi ? `${preset.dpi}` : values.dpiValue,
    lockAspect: preset.ratio !== undefined,
    aspectRatioInput:
      preset.ratio !== undefined && preset.width && preset.height
        ? `${preset.width}:${preset.height}`
        : values.aspectRatioInput,
    maxSizeValue:
      preset.maxBytes === undefined
        ? values.maxSizeValue
        : formatInUnit(preset.maxBytes, pickByteUnit(preset.maxBytes)),
    maxSizeUnit:
      preset.maxBytes === undefined
        ? values.maxSizeUnit
        : pickByteUnit(preset.maxBytes),
    format: preset.outputMimeType
      ? (preset.outputMimeType as OutputFormat)
      : values.format,
  };
};

/**
 * Edits one final output dimension. When only one side is set, the adapter
 * later derives the other from the crop's shape, so this must not silently
 * rewrite the neighbouring field while the user is editing resize settings.
 */
export const setDimension = (
  values: PreparationFormValues,
  edited: "width" | "height",
  next: string,
): PreparationFormValues => {
  return {
    ...values,
    presetId: CUSTOM_PRESET_ID,
    ...(edited === "width" ? { widthValue: next } : { heightValue: next }),
  };
};

/**
 * Switching the unit selector converts the numbers rather than reinterpreting
 * them — "35 mm" becomes "1.38 in", not "35 in". Reinterpreting would change
 * the requirement the user entered every time they looked at it differently.
 */
export const setLengthUnit = (
  values: PreparationFormValues,
  unit: LengthUnit,
  inspection?: FileInspection,
): PreparationFormValues => {
  if (unit === values.lengthUnit) return values;
  const dpi = effectiveDpi(values, inspection);
  const convert = (raw: string): string => {
    const parsed = numberOrUndefined(raw);
    if (parsed === undefined) return raw;
    return formatLength(
      fromPixels(toPixelsRounded(parsed, values.lengthUnit, dpi), unit, dpi),
      unit,
    );
  };
  return {
    ...values,
    lengthUnit: unit,
    widthValue: convert(values.widthValue),
    heightValue: convert(values.heightValue),
  };
};

/**
 * The ratio the crop box should hold, in priority order: an explicit `4:5` the
 * user picked or typed, else the shape of the current crop selection. Final
 * output dimensions are deliberately not a fallback here; resize dimensions and
 * crop shape are separate concepts.
 */
export const resolveLockedRatio = (
  values: PreparationFormValues,
): number | undefined => {
  const typed = parseAspectRatio(values.aspectRatioInput);
  if (typed !== undefined) return typed;

  return values.crop
    ? ratioOf(values.crop.width, values.crop.height)
    : undefined;
};

/** The resolved output size in whole pixels, for the "→ 413 × 531 px" hint. */
export const resolvePixelSize = (
  values: PreparationFormValues,
  inspection?: FileInspection,
): { width?: number; height?: number } => {
  const dpi = effectiveDpi(values, inspection);
  const width = numberOrUndefined(values.widthValue);
  const height = numberOrUndefined(values.heightValue);
  return {
    width:
      width === undefined
        ? undefined
        : toPixelsRounded(width, values.lengthUnit, dpi),
    height:
      height === undefined
        ? undefined
        : toPixelsRounded(height, values.lengthUnit, dpi),
  };
};

export interface ResolvedPreparation {
  readonly spec: PreparationSpec;
  readonly issues: readonly string[];
}

export const resolvePreparationSpec = (
  values: PreparationFormValues,
  inspection: FileInspection,
): ResolvedPreparation => {
  const issues: string[] = [];
  const { width, height } = resolvePixelSize(values, inspection);

  const minSize = numberOrUndefined(values.minSizeValue);
  const maxSize = numberOrUndefined(values.maxSizeValue);
  const minBytes =
    minSize === undefined ? undefined : toBytes(minSize, values.minSizeUnit);
  const maxBytes =
    maxSize === undefined ? undefined : toBytes(maxSize, values.maxSizeUnit);

  if (minBytes !== undefined && maxBytes !== undefined && minBytes > maxBytes) {
    issues.push(
      "The minimum file size is larger than the maximum. Nothing can satisfy both.",
    );
  }

  const lockedAspectRatio = values.lockAspect
    ? resolveLockedRatio(values)
    : undefined;

  if (values.lockAspect && lockedAspectRatio === undefined) {
    issues.push(
      "Choose a crop ratio like 4:5, or switch the crop ratio back to Free.",
    );
  }

  if (
    values.dpiValue.trim() &&
    numberOrUndefined(values.dpiValue) === undefined
  ) {
    issues.push("DPI must be a positive number.");
  }

  if (
    values.lengthUnit !== "px" &&
    !values.dpiValue.trim() &&
    !inspection.dpi
  ) {
    issues.push(
      "This file declares no DPI. Set one if the form requires it to convert physical units to pixels.",
    );
  }

  const spec: PreparationSpec = {
    outputMimeType: values.format === "keep" ? undefined : values.format,
    targetWidth: width,
    targetHeight: height,
    lockedAspectRatio,
    crop: values.cropAppliedInEditor ? undefined : values.crop,
    minBytes,
    maxBytes,
    dpi: numberOrUndefined(values.dpiValue),
    rotationDegrees: values.rotationDegrees,
    flipHorizontal: values.flipHorizontal,
    flipVertical: values.flipVertical,
    allowDownscale: true,
    pageRange:
      inspection.kind === "pdf"
        ? {
            start: numberOrUndefined(values.pageStart) ?? 1,
            end: numberOrUndefined(values.pageEnd) ?? inspection.pageCount ?? 1,
          }
        : undefined,
    pageWidth: numberOrUndefined(values.pageWidth),
    pageHeight: numberOrUndefined(values.pageHeight),
  };

  if (spec.pageRange && spec.pageRange.start > spec.pageRange.end) {
    issues.push("The first page comes after the last page.");
  }

  return { spec, issues };
};

export interface ResolvedPrepareInput {
  readonly input: FileReference;
  readonly spec: PreparationSpec;
  readonly error?: string;
}

const specWithoutEditorCrop = (spec: PreparationSpec): PreparationSpec => ({
  ...spec,
  crop: undefined,
  rotationDegrees: undefined,
  flipHorizontal: undefined,
  flipVertical: undefined,
});

/**
 * Chooses which file ref and spec the panel prepare action should use. Editor
 * crops are already baked into the derived artifact; re-applying `values.crop`
 * on the original uses canvas coordinates as source pixels and exports the
 * wrong region.
 */
export const resolvePrepareInput = (args: {
  readonly original: FileReference;
  /** Cropped copy from the editor, before the user runs Prepare. */
  readonly editorCropDerived?: FileReference;
  /** Final handoff artifact; used when re-preparing after a prior Prepare. */
  readonly prepared?: PreparedArtifact;
  readonly values: PreparationFormValues;
  readonly spec: PreparationSpec;
}): ResolvedPrepareInput => {
  if (!args.values.cropAppliedInEditor) {
    return { input: args.original, spec: args.spec };
  }

  const derived =
    args.editorCropDerived ??
    (args.prepared?.original.id === args.original.id
      ? args.prepared.derived
      : undefined);

  if (!derived) {
    return {
      input: args.original,
      spec: args.spec,
      error:
        "The cropped copy is missing. Open the editor and apply crop again.",
    };
  }

  return {
    input: derived,
    spec: specWithoutEditorCrop(args.spec),
  };
};
