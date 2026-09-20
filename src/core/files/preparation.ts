import type { FieldConstraint } from "../form/types";
import type { FileReference } from "../memory/types";

export type PreparationKind = "image" | "pdf" | "unsupported";

export interface FileInspection {
  readonly kind: PreparationKind;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width?: number;
  readonly height?: number;
  readonly pageCount?: number;
  /**
   * Print resolution parsed from the file's own header — JFIF/EXIF for JPEG,
   * `pHYs` for PNG. Absent when the format cannot carry one or the header is
   * missing, which is the common case for anything a canvas produced.
   */
  readonly dpi?: { readonly x: number; readonly y: number };
}

export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PreparationSpec {
  readonly outputMimeType?: string;
  readonly targetWidth?: number;
  readonly targetHeight?: number;
  /**
   * The tolerance a form allows, as a range. Distinct from
   * `lockedAspectRatio`: this is "the site will accept anything between
   * these", that is "the user pinned exactly this". They were conflated for
   * a long time, which is why neither was ever acted on.
   */
  readonly aspectRatio?: { readonly min: number; readonly max: number };
  /** One exact width / height the user locked. */
  readonly lockedAspectRatio?: number;
  readonly crop?: CropRect;
  readonly minBytes?: number;
  readonly maxBytes?: number;
  /** Print resolution to embed in the output's header, where the format allows. */
  readonly dpi?: number;
  readonly rotationDegrees?: number;
  readonly flipHorizontal?: boolean;
  readonly flipVertical?: boolean;
  /**
   * Whether the adapter may shrink the image to reach `maxBytes` once the
   * quality ladder is exhausted. Defaults to allowed. This is the only lever
   * that exists for PNG, whose quality is pinned at 1.
   */
  readonly allowDownscale?: boolean;
  /** Starting encoder quality, when the caller has a reason to pick one. */
  readonly quality?: number;
  readonly pageRange?: { readonly start: number; readonly end: number };
  readonly pageWidth?: number;
  readonly pageHeight?: number;
}

export interface PreparedArtifact {
  readonly original: FileReference;
  readonly derived: FileReference;
  readonly blob: Blob;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly transformed: boolean;
  readonly inspection: FileInspection;
  readonly validation: readonly string[];
}

export interface PreparationEditor {
  setAspectRatio(ratio: number | undefined): void;
  resetCrop(): void;
  getCrop(): CropRect | undefined;
  destroy(): void;
}

export interface PreparationFailure {
  readonly ok: false;
  readonly reason: string;
}

export type PreparationResult =
  | { readonly ok: true; readonly artifact: PreparedArtifact }
  | PreparationFailure;

export interface FilePreparationAdapter {
  readonly kind: Exclude<PreparationKind, "unsupported">;
  canHandle(file: FileInspection): boolean;
  inspect(file: File): Promise<FileInspection>;
  prepare(
    file: FileReference,
    spec: PreparationSpec,
  ): Promise<PreparationResult>;
  prepareForConstraints(
    file: FileReference,
    constraints: readonly FieldConstraint[],
  ): Promise<PreparationResult>;
  createEditor?(element: HTMLImageElement): Promise<PreparationEditor>;
  cleanup(artifact: PreparedArtifact): Promise<void>;
}
