import Compressor from "compressorjs";
import type { CropperOptions } from "cropperjs";
import type {
  CropRect,
  FileInspection,
  FilePreparationAdapter,
  PreparationEditor,
  PreparationResult,
  PreparationSpec,
  PreparedArtifact,
} from "~/core/files/preparation";
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

const compressWithinLimit = async (
  blob: Blob,
  mimeType: string,
  maxBytes: number | undefined,
) => {
  const qualities = [0.9, 0.78, 0.66, 0.54, 0.42, 0.3, 0.2];
  let result = blob;
  for (const quality of qualities) {
    result = await compress(blob, {
      mimeType,
      quality: mimeType === "image/png" ? 1 : quality,
      strict: false,
    });
    if (!maxBytes || result.size <= maxBytes || mimeType === "image/png") {
      return result;
    }
  }
  return result;
};

export class ImagePreparationAdapter implements FilePreparationAdapter {
  readonly kind = "image" as const;

  constructor(private readonly store: FileReferenceStore) {}

  canHandle(file: FileInspection) {
    return file.mimeType.startsWith("image/");
  }

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

  async inspect(file: File): Promise<FileInspection> {
    const bitmap = await createImageBitmap(file);
    const inspection: FileInspection = {
      kind: "image",
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      width: bitmap.width,
      height: bitmap.height,
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

    const bitmap = await createImageBitmap(record.blob);
    const requestedMimeType =
      spec.outputMimeType ??
      (spec.maxBytes && file.mimeType === "image/png"
        ? "image/jpeg"
        : file.mimeType);
    const mimeType = imageType(requestedMimeType);
    const sourceCrop = spec.crop ?? {
      x: 0,
      y: 0,
      width: bitmap.width,
      height: bitmap.height,
    };
    const width = spec.targetWidth ?? sourceCrop.width;
    const height = spec.targetHeight ?? sourceCrop.height;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
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

    let canvasBlob: Blob | null;
    canvasBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(
        resolve,
        mimeType,
        mimeType === "image/png" ? undefined : 0.9,
      ),
    );
    if (!canvasBlob)
      return {
        ok: false,
        reason: "The browser could not render the prepared image.",
      };

    let blob: Blob;
    try {
      blob = await compressWithinLimit(canvasBlob, mimeType, spec.maxBytes);
    } catch {
      return {
        ok: false,
        reason: "The image could not be encoded in the requested format.",
      };
    }

    if (spec.minBytes && blob.size < spec.minBytes) {
      return {
        ok: false,
        reason: "The prepared image is smaller than the minimum file size.",
      };
    }
    if (spec.maxBytes && blob.size > spec.maxBytes) {
      return {
        ok: false,
        reason: "The prepared image is larger than the maximum file size.",
      };
    }

    const derivedFile = new File([blob], outputName(file.name, mimeType), {
      type: mimeType,
    });
    const derived = await this.store.saveDerived(derivedFile, file);
    return {
      ok: true,
      artifact: {
        original: file,
        derived,
        blob,
        name: derived.name,
        mimeType,
        sizeBytes: blob.size,
        transformed: true,
        inspection: {
          kind: "image",
          name: derived.name,
          mimeType,
          sizeBytes: blob.size,
          width: canvas.width,
          height: canvas.height,
        },
        validation: [
          "Output dimensions applied",
          "Output format applied",
          "File size validated",
        ],
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
    });
  }

  async cleanup(artifact: PreparedArtifact) {
    await this.store.delete(artifact.derived.id);
  }
}

export const createImageCropEditor = async (
  element: HTMLImageElement,
  options?: CropperOptions,
) => {
  const { default: Cropper } = await import("cropperjs");
  return new Cropper(element, options);
};
