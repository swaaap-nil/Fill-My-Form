import { PDFDocument } from "pdf-lib";
import type {
  FileInspection,
  FilePreparationAdapter,
  PreparationResult,
  PreparationSpec,
} from "~/core/files/preparation";
import {
  acceptsFileReference,
  fileSizeRangeBytes,
  maxFileSizeBytes,
} from "~/core/files/types";
import type { FieldConstraint } from "~/core/form/types";
import type { FileReference } from "~/core/memory/types";
import type { FileReferenceStore } from "./adapters";

const isPdf = (file: FileInspection) =>
  file.mimeType === "application/pdf" ||
  file.name.toLowerCase().endsWith(".pdf");

export class PdfPreparationAdapter implements FilePreparationAdapter {
  readonly kind = "pdf" as const;

  constructor(private readonly store: FileReferenceStore) {}

  canHandle(file: FileInspection) {
    return isPdf(file);
  }

  async inspect(file: File): Promise<FileInspection> {
    const document = await PDFDocument.load(await file.arrayBuffer());
    return {
      kind: "pdf",
      name: file.name,
      mimeType: "application/pdf",
      sizeBytes: file.size,
      pageCount: document.getPageCount(),
    };
  }

  async prepare(
    file: FileReference,
    spec: PreparationSpec,
  ): Promise<PreparationResult> {
    const record = await this.store.get(file.id);
    if (!record)
      return { ok: false, reason: "The original file is no longer available." };

    try {
      const document = await PDFDocument.load(await record.blob.arrayBuffer());
      const pageCount = document.getPageCount();
      const start = Math.max(1, spec.pageRange?.start ?? 1);
      const end = Math.min(pageCount, spec.pageRange?.end ?? pageCount);
      if (start > end)
        return {
          ok: false,
          reason: "The requested PDF page range is invalid.",
        };

      for (let index = pageCount - 1; index >= 0; index--) {
        if (index < start - 1 || index > end - 1) document.removePage(index);
      }
      for (const page of document.getPages()) {
        if (spec.pageWidth && spec.pageHeight)
          page.setSize(spec.pageWidth, spec.pageHeight);
        if (spec.crop)
          page.setCropBox(
            spec.crop.x,
            spec.crop.y,
            spec.crop.width,
            spec.crop.height,
          );
      }

      const bytes = await document.save({ useObjectStreams: true });
      const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      if (spec.minBytes && blob.size < spec.minBytes)
        return {
          ok: false,
          reason: "The prepared PDF is smaller than the minimum file size.",
        };
      if (spec.maxBytes && blob.size > spec.maxBytes)
        return {
          ok: false,
          reason: "The prepared PDF is larger than the maximum file size.",
        };

      const derivedFile = new File(
        [blob],
        `${file.name.replace(/\.[^.]+$/, "")}-prepared.pdf`,
        { type: "application/pdf" },
      );
      const derived = await this.store.saveDerived(derivedFile, file);
      return {
        ok: true,
        artifact: {
          original: file,
          derived,
          blob,
          name: derived.name,
          mimeType: "application/pdf",
          sizeBytes: blob.size,
          transformed: true,
          inspection: {
            kind: "pdf",
            name: derived.name,
            mimeType: "application/pdf",
            sizeBytes: blob.size,
            pageCount: end - start + 1,
          },
          validation: [
            "Page range applied",
            "Page geometry applied",
            "File size validated",
          ],
        },
      };
    } catch {
      return {
        ok: false,
        reason:
          "This PDF is malformed, encrypted, or cannot be edited locally.",
      };
    }
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
    const range = fileSizeRangeBytes(constraints);
    return this.prepare(file, {
      minBytes: range?.min,
      maxBytes: maxFileSizeBytes(constraints) ?? range?.max,
    });
  }

  async cleanup(artifact: { readonly derived: FileReference }) {
    await this.store.delete(artifact.derived.id);
  }
}
