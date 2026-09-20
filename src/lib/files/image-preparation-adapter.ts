import Compressor from "compressorjs";
import type { CropperOptions } from "cropperjs";
import { formatBytes } from "~/core/files/byte-units";
import {
  canWriteImageDensity,
  readImageDensity,
  writeImageDensity,
} from "~/core/files/dpi";
import type {
  CropRect,
  FileInspection,
  FilePreparationAdapter,
  PreparationEditor,
  PreparationResult,
  PreparationSpec,
  PreparedArtifact,
} from "~/core/files/preparation";
import { resolveTargetSize } from "~/core/files/target-size";
import {
  acceptsFileReference,
  fileSizeRangeBytes,
  maxFileSizeBytes,
} from "~/core/files/types";
import type { FieldConstraint } from "~/core/form/types";
import type { FileReference } from "~/core/memory/types";
import type { FileReferenceStore } from "./adapters";

const imageType = (mimeType: string) =>
  mimeType === "image/png" || mimeType === "image/webp"
    ? mimeType
    : "image/jpeg";

const formatLabel = (mimeType: string) =>
  mimeType === "image/png"
    ? "PNG"
    : mimeType === "image/webp"
      ? "WebP"
      : "JPEG";

const outputName = (name: string, mimeType: string) => {
  const extension =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : "jpg";
  return `${name.replace(/\.[^.]+$/, "")}.${extension}`;
};

const compress = (blob: Blob, options: Compressor.Options): Promise<Blob> =>
  new Promise((resolve, reject) => {
    new Compressor(blob, { ...options, success: resolve, error: reject });
  });

const QUALITY_LADDER = [0.9, 0.78, 0.66, 0.54, 0.42, 0.3, 0.2] as const;

/**
 * How far each downscale step shrinks the image, how small it may get, and how
 * many times to try. 0.85 per step is gentle enough that the first step often
 * suffices; eight steps reaches about 27% of the original edge length, which is
 * past the point where any further gain is worth the loss of detail.
 */
const DOWNSCALE_STEP = 0.85;
const MIN_DIMENSION = 64;
const MAX_DOWNSCALE_STEPS = 8;

interface EncodeAttempt {
  readonly blob: Blob;
  readonly quality: number;
}

/**
 * Walks the quality ladder until the blob fits. PNG is encoded once at quality
 * 1 and returned regardless — its encoder is lossless, so quality is not a
 * lever at all. Shrinking a PNG is the downscale loop's job.
 */
const compressWithinLimit = async (
  blob: Blob,
  mimeType: string,
  maxBytes: number | undefined,
): Promise<EncodeAttempt> => {
  let result = blob;
  let quality = 1;
  for (const candidate of QUALITY_LADDER) {
    quality = candidate;
    result = await compress(blob, {
      mimeType,
      quality: mimeType === "image/png" ? 1 : candidate,
      strict: false,
    });
    if (!maxBytes || result.size <= maxBytes || mimeType === "image/png") {
      return {
        blob: result,
        quality: mimeType === "image/png" ? 1 : candidate,
      };
    }
  }
  return { blob: result, quality };
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number | undefined,
): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));

const scaleCanvas = (
  source: HTMLCanvasElement,
  width: number,
  height: number,
): HTMLCanvasElement | undefined => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
};

interface EncodeOutcome {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly notes: readonly string[];
  readonly withinLimit: boolean;
}

export class ImagePreparationAdapter implements FilePreparationAdapter {
  readonly kind = "image" as const;

  constructor(private readonly store: FileReferenceStore) {}

  async createEditor(element: HTMLImageElement): Promise<PreparationEditor> {
    const { default: Cropper } = await import("cropperjs");
    const cropper = new Cropper(element);
    return {
      setAspectRatio(ratio) {
        const selection = cropper.getCropperSelection();
        if (selection) {
          selection.aspectRatio = ratio ?? 0;
          selection.$reset();
        }
      },
      resetCrop() {
        cropper.getCropperSelection()?.$reset();
      },
      getCrop(): CropRect | undefined {
        const selection = cropper.getCropperSelection();
        if (!selection) return undefined;
        return {
          x: selection.x,
          y: selection.y,
          width: selection.width,
          height: selection.height,
        };
      },
      destroy() {
        cropper.destroy();
      },
    };
  }

  canHandle(file: FileInspection) {
    return file.mimeType.startsWith("image/");
  }

  async inspect(file: File): Promise<FileInspection> {
    // `from-image` matters for phone photos: without it an EXIF-rotated source
    // decodes upright in some browsers and sideways in others, so the crop
    // rectangle would address the wrong region.
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const inspection: FileInspection = {
      kind: "image",
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      width: bitmap.width,
      height: bitmap.height,
      dpi: await readDensityOf(file),
    };
    bitmap.close();
    return inspection;
  }

  async prepare(
    file: FileReference,
    spec: PreparationSpec,
  ): Promise<PreparationResult> {
    const record = await this.store.get(file.id);
    if (!record)
      return { ok: false, reason: "The original file is no longer available." };

    const bitmap = await createImageBitmap(record.blob, {
      imageOrientation: "from-image",
    });
    const sourceCrop = spec.crop ?? {
      x: 0,
      y: 0,
      width: bitmap.width,
      height: bitmap.height,
    };
    const target = resolveTargetSize(spec, sourceCrop);

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return {
        ok: false,
        reason: "This browser cannot create an image canvas.",
      };
    }
    context.drawImage(
      bitmap,
      sourceCrop.x,
      sourceCrop.y,
      sourceCrop.width,
      sourceCrop.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    bitmap.close();

    const cropNote =
      spec.crop &&
      (spec.crop.width !== target.width || spec.crop.height !== target.height)
        ? [
            `Cropped to ${target.width}x${target.height}px from ${Math.round(spec.crop.width)}x${Math.round(spec.crop.height)}px`,
          ]
        : [`Output sized to ${target.width}x${target.height}px`];

    return this.prepareFromCanvas(file, canvas, spec, [
      ...cropNote,
      ...target.notes,
    ]);
  }

  /**
   * The encode half, separated so the editor window can hand in a canvas that
   * Cropper already rendered through the image's transform matrix — rotation
   * and flips applied once, by the cropper, rather than reimplemented here.
   */
  async prepareFromCanvas(
    file: FileReference,
    canvas: HTMLCanvasElement,
    spec: PreparationSpec,
    priorNotes: readonly string[] = [],
  ): Promise<PreparationResult> {
    const mimeType = resolveOutputType(file, spec);
    const notes = [...priorNotes];

    if (
      !spec.outputMimeType &&
      mimeType !== imageType(file.mimeType) &&
      file.mimeType === "image/png"
    ) {
      notes.push(
        "Converted PNG to JPEG to meet the size limit; choose a format explicitly to override",
      );
    }

    let outcome: EncodeOutcome;
    try {
      outcome = await encodeWithinLimit(canvas, mimeType, spec);
    } catch {
      return {
        ok: false,
        reason: "The image could not be encoded in the requested format.",
      };
    }
    notes.push(...outcome.notes);

    if (spec.minBytes && outcome.blob.size < spec.minBytes) {
      return {
        ok: false,
        reason: `The prepared image is ${formatBytes(outcome.blob.size)}, below the ${formatBytes(spec.minBytes)} minimum. Try a larger size or a less compressible format such as PNG.`,
      };
    }
    if (!outcome.withinLimit && spec.maxBytes) {
      return {
        ok: false,
        reason: `Could not reach ${formatBytes(spec.maxBytes)}: the smallest result was ${formatBytes(outcome.blob.size)} at ${outcome.width}x${outcome.height}px.${
          mimeType === "image/png"
            ? " PNG cannot be compressed further — try JPEG."
            : " Try a smaller target size or a higher limit."
        }`,
      };
    }

    if (spec.maxBytes) {
      notes.push(
        `${formatBytes(outcome.blob.size)}, within the ${formatBytes(spec.maxBytes)} limit`,
      );
    } else {
      notes.push(`Output is ${formatBytes(outcome.blob.size)}`);
    }

    const derivedFile = new File(
      [outcome.blob],
      outputName(file.name, mimeType),
      {
        type: mimeType,
      },
    );
    const derived = await this.store.saveDerived(derivedFile, file);
    return {
      ok: true,
      artifact: {
        original: file,
        derived,
        blob: outcome.blob,
        name: derived.name,
        mimeType,
        sizeBytes: outcome.blob.size,
        transformed: true,
        inspection: {
          kind: "image",
          name: derived.name,
          mimeType,
          sizeBytes: outcome.blob.size,
          width: outcome.width,
          height: outcome.height,
          dpi: spec.dpi ? { x: spec.dpi, y: spec.dpi } : undefined,
        },
        validation: notes,
      },
    };
  }

  async prepareForConstraints(
    file: FileReference,
    constraints: readonly FieldConstraint[],
  ) {
    if (!acceptsFileReference(file, constraints)) {
      return {
        ok: false as const,
        reason: "The file type is not accepted by this upload.",
      };
    }
    const dimensions = constraints.filter(
      (constraint) => constraint.kind === "dimensions",
    );
    const maxDimension = dimensions.find(
      (constraint) =>
        constraint.kind === "dimensions" && constraint.bound === "max",
    );
    const range = fileSizeRangeBytes(constraints);
    return this.prepare(file, {
      outputMimeType: constraints
        .find((constraint) => constraint.kind === "accept")
        ?.value.find((value) => value.startsWith("image/")),
      targetWidth:
        maxDimension?.kind === "dimensions"
          ? maxDimension.value.width
          : undefined,
      targetHeight:
        maxDimension?.kind === "dimensions"
          ? maxDimension.value.height
          : undefined,
      minBytes: range?.min,
      maxBytes: maxFileSizeBytes(constraints) ?? range?.max,
      allowDownscale: true,
    });
  }

  async cleanup(artifact: PreparedArtifact) {
    await this.store.delete(artifact.derived.id);
  }
}

/**
 * An explicit format choice always wins. The implicit PNG-to-JPEG swap only
 * fires when the caller expressed no preference — previously it overrode even
 * a deliberate "keep this as a PNG".
 */
const resolveOutputType = (
  file: FileReference,
  spec: PreparationSpec,
): string => {
  if (spec.outputMimeType) return imageType(spec.outputMimeType);
  if (spec.maxBytes && file.mimeType === "image/png") return "image/jpeg";
  return imageType(file.mimeType);
};

/** Reads the source file's declared DPI, treating any failure as "none". */
const readDensityOf = async (
  file: File,
): Promise<{ x: number; y: number } | undefined> => {
  try {
    // Density headers live near the start of the file; 64 KB covers JFIF, a
    // typical EXIF block and PNG's pHYs without reading a whole photo.
    const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    const density = readImageDensity(head);
    return density ? { x: density.x, y: density.y } : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Encodes, then falls back to shrinking when the quality ladder cannot reach
 * `maxBytes`. Downscaling is the only lever PNG has — its quality is pinned at
 * 1 — so without this a PNG over the limit simply failed.
 */
const encodeWithinLimit = async (
  canvas: HTMLCanvasElement,
  mimeType: string,
  spec: PreparationSpec,
): Promise<EncodeOutcome> => {
  const notes: string[] = [];
  const allowDownscale = spec.allowDownscale !== false;
  let current = canvas;
  let last: { blob: Blob; width: number; height: number } | undefined;

  for (let step = 0; step <= MAX_DOWNSCALE_STEPS; step += 1) {
    const canvasBlob = await canvasToBlob(
      current,
      mimeType,
      mimeType === "image/png" ? undefined : (spec.quality ?? 0.9),
    );
    if (!canvasBlob) {
      throw new Error("The browser could not render the prepared image.");
    }

    const attempt = await compressWithinLimit(
      canvasBlob,
      mimeType,
      spec.maxBytes,
    );
    const blob = await applyDensity(
      attempt.blob,
      mimeType,
      spec,
      notes,
      step === 0,
    );
    last = { blob, width: current.width, height: current.height };

    if (!spec.maxBytes || blob.size <= spec.maxBytes) {
      if (mimeType !== "image/png") {
        notes.push(
          `Encoded as ${formatLabel(mimeType)} at quality ${attempt.quality}`,
        );
      } else {
        notes.push(`Encoded as ${formatLabel(mimeType)}`);
      }
      if (step > 0) {
        notes.push(
          `Downscaled ${step} step${step === 1 ? "" : "s"} to ${current.width}x${current.height}px to reach ${formatBytes(spec.maxBytes as number)}`,
        );
      }
      return { ...last, notes, withinLimit: true };
    }

    if (!allowDownscale || step === MAX_DOWNSCALE_STEPS) break;

    const nextWidth = Math.round(current.width * DOWNSCALE_STEP);
    const nextHeight = Math.round(current.height * DOWNSCALE_STEP);
    if (nextWidth < MIN_DIMENSION || nextHeight < MIN_DIMENSION) break;

    const scaled = scaleCanvas(current, nextWidth, nextHeight);
    if (!scaled) break;
    current = scaled;
  }

  const resolved = last as { blob: Blob; width: number; height: number };
  return { ...resolved, notes, withinLimit: false };
};

/**
 * Writes the requested DPI into the encoded bytes. This runs *before* the size
 * check, because the patch can add up to 21 bytes and a limit checked
 * beforehand would be checking the wrong number.
 */
const applyDensity = async (
  blob: Blob,
  mimeType: string,
  spec: PreparationSpec,
  notes: string[],
  note: boolean,
): Promise<Blob> => {
  if (!spec.dpi) return blob;
  if (!canWriteImageDensity(mimeType)) {
    if (note) {
      notes.push(
        `${formatLabel(mimeType)} cannot store a DPI value; the pixel size is unchanged`,
      );
    }
    return blob;
  }
  try {
    const source = new Uint8Array(await blob.arrayBuffer());
    const patched = writeImageDensity(source, spec.dpi);
    if (patched === source) return blob;
    if (note) notes.push(`DPI set to ${Math.round(spec.dpi)}`);
    return new Blob([patched as BlobPart], { type: mimeType });
  } catch {
    return blob;
  }
};

export const createImageCropEditor = async (
  element: HTMLImageElement,
  options?: CropperOptions,
) => {
  const { default: Cropper } = await import("cropperjs");
  return new Cropper(element, options);
};
