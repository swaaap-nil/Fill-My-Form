import type { FieldConstraint } from "../form/types";
import type { FileReference } from "../memory/types";

export interface FilePayload {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface PreparedFileUpload {
  readonly ref: FileReference;
  readonly payload: FilePayload;
  readonly transformed: boolean;
  readonly originalSizeBytes: number;
}

export type PrepareFileResult =
  | { readonly ok: true; readonly upload: PreparedFileUpload }
  | { readonly ok: false; readonly reason: string };

export interface FileComplianceAdapter {
  prepareForUpload(
    ref: FileReference,
    constraints: readonly FieldConstraint[],
  ): Promise<PrepareFileResult>;
}

const extensionOf = (name: string): string => {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
};

const matchesAcceptToken = (ref: FileReference, token: string): boolean => {
  const accept = token.trim().toLowerCase();
  if (!accept) return false;
  if (accept.startsWith(".")) return extensionOf(ref.name) === accept;
  if (accept.endsWith("/*")) {
    return ref.mimeType.toLowerCase().startsWith(accept.slice(0, -1));
  }
  return ref.mimeType.toLowerCase() === accept;
};

export const acceptsFileReference = (
  ref: FileReference,
  constraints: readonly FieldConstraint[],
): boolean => {
  const accept = constraints.find((c) => c.kind === "accept");
  if (!accept) return true;
  return accept.value.some((token) => matchesAcceptToken(ref, token));
};

export const maxFileSizeBytes = (
  constraints: readonly FieldConstraint[],
): number | undefined =>
  constraints.find((c) => c.kind === "maxFileSizeBytes")?.value;

export const fileSizeRangeBytes = (
  constraints: readonly FieldConstraint[],
): { readonly min?: number; readonly max?: number } | undefined =>
  constraints.find((c) => c.kind === "fileSizeRangeBytes")?.value;
