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
  readonly aspectRatio?: { readonly min: number; readonly max: number };
  readonly crop?: CropRect;
  readonly minBytes?: number;
  readonly maxBytes?: number;
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
