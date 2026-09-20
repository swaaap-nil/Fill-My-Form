import type {
  FileComplianceAdapter,
  PrepareFileResult,
} from "~/core/files/types";
import type { FieldConstraint } from "~/core/form/types";
import type { FileReference } from "~/core/memory/types";
import { createBrowserFilePreparationRegistry } from "./preparation-registry";

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
  getFile(refId: string): Promise<File | null>;
  delete(refId: string): Promise<void>;
  clear(): Promise<void>;
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

    async getFile(refId) {
      const transaction = db.transaction(FILE_STORE, "readonly");
      const record = await requestToPromise(
        transaction.objectStore(FILE_STORE).get(refId) as IDBRequest<
          StoredFileRecord | undefined
        >,
      );
      if (!record) return null;
      return new File([record.blob], record.ref.name, {
        type: record.ref.mimeType,
      });
    },

    async delete(refId) {
      const transaction = db.transaction(FILE_STORE, "readwrite");
      transaction.objectStore(FILE_STORE).delete(refId);
      await transactionDone(transaction);
    },

    async clear() {
      const transaction = db.transaction(FILE_STORE, "readwrite");
      transaction.objectStore(FILE_STORE).clear();
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
    const record = await store.get(ref.id);
    if (!record) return null;
    const registry = createBrowserFilePreparationRegistry(store);
    const adapter = registry.adapterFor({
      kind:
        ref.mimeType === "application/pdf" ||
        ref.name.toLowerCase().endsWith(".pdf")
          ? "pdf"
          : ref.mimeType.startsWith("image/")
            ? "image"
            : "unsupported",
      name: ref.name,
      mimeType: ref.mimeType,
      sizeBytes: ref.sizeBytes,
    });
    if (!adapter) return null;
    const prepared = await adapter.prepareForConstraints(ref, constraints);
    if (!prepared.ok) return null;
    return {
      ref,
      blob: prepared.artifact.blob,
      name: prepared.artifact.name,
      mimeType: prepared.artifact.mimeType,
      transformed: prepared.artifact.transformed,
      originalSizeBytes: ref.sizeBytes,
      // Passthrough reuses the original; deleting it would wipe the saved file.
      temporaryRef: prepared.artifact.transformed
        ? prepared.artifact.derived
        : undefined,
    };
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
    cleanupPreparedFile: async (ref) => store.delete(ref.id),
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
