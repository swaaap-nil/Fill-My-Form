import Compressor from "compressorjs";
import {
  acceptsFileReference,
  type FileComplianceAdapter,
  fileSizeRangeBytes,
  maxFileSizeBytes,
  type PrepareFileResult,
} from "~/core/files/types";
import type { FieldConstraint } from "~/core/form/types";
import type { FileReference } from "~/core/memory/types";

const DB_NAME = "form-agent-files";
const DB_VERSION = 2;
const FILE_STORE = "files";

interface StoredFileRecord {
  readonly id: string;
  readonly ref: FileReference;
  readonly blob: Blob;
}

export interface FileReferenceStore {
  save(file: File, now?: string): Promise<FileReference>;
  saveDerived(
    file: File,
    source: FileReference,
    now?: string,
    ttlMs?: number,
  ): Promise<FileReference>;
  get(refId: string): Promise<StoredFileRecord | null>;
  delete(refId: string): Promise<void>;
  list(): Promise<FileReference[]>;
  purgeExpired(now?: string): Promise<number>;
}

export interface BrowserPreparedFile {
  readonly ref: FileReference;
  readonly blob: Blob;
  readonly name: string;
  readonly mimeType: string;
  readonly transformed: boolean;
  readonly originalSizeBytes: number;
  readonly temporaryRef?: FileReference;
}

export interface BrowserFileUploadAdapter {
  upload(target: Element, file: BrowserPreparedFile): boolean;
}

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const openDatabase = (factory: IDBFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const createIndexedDbFileReferenceStore = async (
  indexedDB: IDBFactory = globalThis.indexedDB,
): Promise<FileReferenceStore> => {
  const db = await openDatabase(indexedDB);

  return {
    async save(file, now = new Date().toISOString()) {
      const ref: FileReference = {
        kind: "file_ref",
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        createdAt: now,
        artifactKind: "original",
      };
      const transaction = db.transaction(FILE_STORE, "readwrite");
      transaction.objectStore(FILE_STORE).put({ id: ref.id, ref, blob: file });
      await transactionDone(transaction);
      return ref;
    },

    async saveDerived(
      file,
      source,
      now = new Date().toISOString(),
      ttlMs = 24 * 60 * 60 * 1000,
    ) {
      const ref: FileReference = {
        kind: "file_ref",
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        createdAt: now,
        artifactKind: "derived",
        derivedFrom: source.id,
        expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
      };
      const transaction = db.transaction(FILE_STORE, "readwrite");
      transaction.objectStore(FILE_STORE).put({ id: ref.id, ref, blob: file });
      await transactionDone(transaction);
      return ref;
    },

    async get(refId) {
      const transaction = db.transaction(FILE_STORE, "readonly");
      const result = await requestToPromise(
        transaction.objectStore(FILE_STORE).get(refId) as IDBRequest<
          StoredFileRecord | undefined
        >,
      );
      return result ?? null;
    },

    async delete(refId) {
      const transaction = db.transaction(FILE_STORE, "readwrite");
      transaction.objectStore(FILE_STORE).delete(refId);
      await transactionDone(transaction);
    },

    async list() {
      const transaction = db.transaction(FILE_STORE, "readonly");
      const records = await requestToPromise(
        transaction.objectStore(FILE_STORE).getAll() as IDBRequest<
          StoredFileRecord[]
        >,
      );
      return records.map((record) => record.ref);
    },

    async purgeExpired(now = new Date().toISOString()) {
      const records = await requestToPromise(
        db
          .transaction(FILE_STORE, "readonly")
          .objectStore(FILE_STORE)
          .getAll() as IDBRequest<StoredFileRecord[]>,
      );
      const expired = records.filter(
        (record) => record.ref.expiresAt && record.ref.expiresAt <= now,
      );
      if (!expired.length) return 0;
      const transaction = db.transaction(FILE_STORE, "readwrite");
      for (const record of expired)
        transaction.objectStore(FILE_STORE).delete(record.id);
      await transactionDone(transaction);
      return expired.length;
    },
  };
};

const compressImage = (
  blob: Blob,
  options: Compressor.Options,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    new Compressor(blob, { ...options, success: resolve, error: reject });
  });

const recompressedImageType = (mimeType: string): string =>
  mimeType === "image/webp" ? "image/webp" : "image/jpeg";

const recompressedImageName = (name: string, mimeType: string): string => {
  if (mimeType === "image/webp") return name.replace(/\.[^.]+$/, ".webp");
  return name.replace(/\.[^.]+$/, ".jpg");
};

export const createBrowserFileComplianceAdapter = (
  store: FileReferenceStore,
): FileComplianceAdapter & {
  prepareLocalFile(
    ref: FileReference,
    constraints: readonly FieldConstraint[],
  ): Promise<BrowserPreparedFile | null>;
  cleanupPreparedFile(ref: FileReference): Promise<void>;
} => {
  const prepareLocalFile = async (
    ref: FileReference,
    constraints: readonly FieldConstraint[],
  ): Promise<BrowserPreparedFile | null> => {
    if (!acceptsFileReference(ref, constraints)) return null;

    const record = await store.get(ref.id);
    if (!record) return null;

    const maxBytes =
      maxFileSizeBytes(constraints) ?? fileSizeRangeBytes(constraints)?.max;
    const minBytes = fileSizeRangeBytes(constraints)?.min;
    const dimensionConstraints = constraints.filter(
      (c) => c.kind === "dimensions",
    );
    const image = record.ref.mimeType.startsWith("image/")
      ? await createImageBitmap(record.blob)
      : null;
    const tooSmall =
      image &&
      dimensionConstraints.some(
        (constraint) =>
          constraint.kind === "dimensions" &&
          constraint.bound === "min" &&
          (image.width < constraint.value.width ||
            image.height < constraint.value.height),
      );
    if (tooSmall) {
      image?.close();
      return null;
    }
    if (
      (!maxBytes || record.blob.size <= maxBytes) &&
      (!minBytes || record.blob.size >= minBytes)
    ) {
      image?.close();
      const temporaryFile = new File([record.blob], ref.name, {
        type: ref.mimeType,
      });
      const temporaryRef = await store.saveDerived(temporaryFile, ref);
      return {
        ref,
        blob: temporaryFile,
        name: temporaryFile.name,
        mimeType: temporaryFile.type,
        transformed: false,
        originalSizeBytes: ref.sizeBytes,
        temporaryRef,
      };
    }

    if (!image) return null;
    const outputType = recompressedImageType(ref.mimeType);
    const maxDimension = dimensionConstraints.find(
      (constraint) =>
        constraint.kind === "dimensions" && constraint.bound === "max",
    );
    const maxWidth =
      maxDimension?.kind === "dimensions"
        ? maxDimension.value.width
        : undefined;
    const maxHeight =
      maxDimension?.kind === "dimensions"
        ? maxDimension.value.height
        : undefined;
    try {
      for (const quality of [0.85, 0.72, 0.6, 0.48, 0.36, 0.25]) {
        const blob = await compressImage(record.blob, {
          quality,
          mimeType: outputType,
          maxWidth,
          maxHeight,
          strict: true,
        });
        if (
          blob &&
          (!maxBytes || blob.size <= maxBytes) &&
          (!minBytes || blob.size >= minBytes)
        ) {
          const temporaryFile = new File(
            [blob],
            recompressedImageName(ref.name, outputType),
            { type: outputType },
          );
          const temporaryRef = await store.saveDerived(temporaryFile, ref);
          return {
            ref,
            blob,
            name: temporaryFile.name,
            mimeType: outputType,
            transformed: true,
            originalSizeBytes: ref.sizeBytes,
            temporaryRef,
          };
        }
      }
    } finally {
      image.close();
    }

    return null;
  };

  return {
    async prepareForUpload(ref, constraints): Promise<PrepareFileResult> {
      const prepared = await prepareLocalFile(ref, constraints);
      if (!prepared) {
        return {
          ok: false,
          reason: "File does not satisfy upload constraints.",
        };
      }
      return {
        ok: true,
        upload: {
          ref,
          payload: {
            name: prepared.name,
            mimeType: prepared.mimeType,
            sizeBytes: prepared.blob.size,
          },
          transformed: prepared.transformed,
          originalSizeBytes: prepared.originalSizeBytes,
        },
      };
    },
    prepareLocalFile,
    cleanupPreparedFile: async (ref) => {
      if (ref.artifactKind === "derived") await store.delete(ref.id);
    },
  };
};

export const createBrowserFileUploadAdapter = (): BrowserFileUploadAdapter => ({
  upload(target, file) {
    if (!(target instanceof HTMLInputElement) || target.type !== "file") {
      return false;
    }
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File([file.blob], file.name, {
        type: file.mimeType,
        lastModified: Date.now(),
      }),
    );
    target.files = dataTransfer.files;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return target.files?.[0]?.name === file.name;
  },
});
