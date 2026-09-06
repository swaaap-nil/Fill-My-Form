import {
  acceptsFileReference,
  type FileComplianceAdapter,
  maxFileSizeBytes,
  type PrepareFileResult,
} from "~/core/files/types";
import type { FieldConstraint } from "~/core/form/types";
import type { FileReference } from "~/core/memory/types";

const DB_NAME = "form-agent-files";
const DB_VERSION = 1;
const FILE_STORE = "files";

interface StoredFileRecord {
  readonly id: string;
  readonly ref: FileReference;
  readonly blob: Blob;
}

export interface FileReferenceStore {
  save(file: File, now?: string): Promise<FileReference>;
  get(refId: string): Promise<StoredFileRecord | null>;
  delete(refId: string): Promise<void>;
  list(): Promise<FileReference[]>;
}

export interface BrowserPreparedFile {
  readonly ref: FileReference;
  readonly blob: Blob;
  readonly name: string;
  readonly mimeType: string;
  readonly transformed: boolean;
  readonly originalSizeBytes: number;
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
  };
};

const blobForImage = async (
  image: ImageBitmap,
  type: string,
  quality: number,
): Promise<Blob | null> => {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0);
  return canvas.convertToBlob({ type, quality });
};

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
} => {
  const prepareLocalFile = async (
    ref: FileReference,
    constraints: readonly FieldConstraint[],
  ): Promise<BrowserPreparedFile | null> => {
    if (!acceptsFileReference(ref, constraints)) return null;

    const record = await store.get(ref.id);
    if (!record) return null;

    const maxBytes = maxFileSizeBytes(constraints);
    if (!maxBytes || record.blob.size <= maxBytes) {
      return {
        ref,
        blob: record.blob,
        name: ref.name,
        mimeType: ref.mimeType,
        transformed: false,
        originalSizeBytes: ref.sizeBytes,
      };
    }

    if (!ref.mimeType.startsWith("image/")) return null;

    const image = await createImageBitmap(record.blob);
    const outputType = recompressedImageType(ref.mimeType);
    try {
      for (const quality of [0.85, 0.72, 0.6, 0.48, 0.36, 0.25]) {
        const blob = await blobForImage(image, outputType, quality);
        if (blob && blob.size <= maxBytes) {
          return {
            ref,
            blob,
            name: recompressedImageName(ref.name, outputType),
            mimeType: outputType,
            transformed: true,
            originalSizeBytes: ref.sizeBytes,
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
