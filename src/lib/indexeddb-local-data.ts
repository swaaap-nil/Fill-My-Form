import type { RecordUnresolvedFieldInput } from "~/core/journal/store";
import { containsStoredValue } from "~/core/journal/store";
import type { UnresolvedField } from "~/core/journal/types";
import { MatchTier } from "~/core/matching/types";
import { refreshMemoryItemHorizon } from "~/core/memory/freshness";
import {
  bundledFreshnessDurationPolicy,
  type FreshnessDurationPolicy,
} from "~/core/memory/freshness-policy";
import type { MemoryStore } from "~/core/memory/store";
import {
  CURRENT_MEMORY_SCHEMA_VERSION,
  isFileReference,
  type MemoryItem,
  type MemoryKey,
  type MemoryQuery,
  MemorySource,
  type MemoryValue,
  type ProfileId,
} from "~/core/memory/types";
import type { ConceptIndex } from "~/core/ontology";
import { normaliseLabel, ontology } from "~/core/ontology";

const DB_NAME = "form-agent-local-data";
const DB_VERSION = 1;
const MEMORY_STORE = "memory";
const JOURNAL_STORE = "journal";
const LOCAL_EXPORT_SCHEMA_VERSION = 1;

export interface LocalDataExport {
  readonly schemaVersion: typeof LOCAL_EXPORT_SCHEMA_VERSION;
  readonly exportedAt: string;
  readonly memory: readonly MemoryItem[];
  readonly journal: readonly UnresolvedField[];
}

export interface PersistentLocalDataStore extends MemoryStore {
  allMemory(): Promise<MemoryItem[]>;
  recordUnresolvedField(
    input: RecordUnresolvedFieldInput,
    memoryValues: readonly string[],
  ): Promise<boolean>;
  allJournal(): Promise<UnresolvedField[]>;
  exportLocalData(): Promise<LocalDataExport>;
  importLocalData(data: LocalDataExport): Promise<void>;
  wipeLocalData(): Promise<void>;
}

export interface IndexedDbLocalDataOptions {
  readonly indexedDB?: IDBFactory;
  readonly conceptIndex?: ConceptIndex;
  readonly freshnessPolicy?: FreshnessDurationPolicy;
  readonly now?: () => string;
}

const keyOf = (origin: string, fieldKey: string): IDBValidKey => [
  origin,
  fieldKey,
];

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
      if (!db.objectStoreNames.contains(MEMORY_STORE)) {
        db.createObjectStore(MEMORY_STORE, { keyPath: ["profileId", "key"] });
      }
      if (!db.objectStoreNames.contains(JOURNAL_STORE)) {
        db.createObjectStore(JOURNAL_STORE, {
          keyPath: ["origin", "fieldKey"],
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const isMemorySource = (source: unknown): source is MemorySource =>
  Object.values(MemorySource).includes(source as MemorySource);

const isMemoryValue = (value: unknown): value is MemoryValue => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (isFileReference(value)) return true;
  if (Array.isArray(value)) return value.every((v) => typeof v === "string");
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every(isMemoryValue);
};

const isMemoryItem = (value: unknown): value is MemoryItem => {
  if (!value || typeof value !== "object") return false;
  const item = value as MemoryItem;
  return (
    typeof item.profileId === "string" &&
    typeof item.key === "string" &&
    isMemoryValue(item.value) &&
    typeof item.schemaVersion === "number" &&
    (!item.label || typeof item.label === "string") &&
    !!item.provenance &&
    isMemorySource(item.provenance.source) &&
    typeof item.provenance.confidence === "number" &&
    typeof item.provenance.confirmedByUser === "boolean" &&
    typeof item.provenance.createdAt === "string" &&
    typeof item.provenance.updatedAt === "string" &&
    (!item.provenance.expiresAt ||
      typeof item.provenance.expiresAt === "string") &&
    (!item.provenance.freshnessRule ||
      typeof item.provenance.freshnessRule === "string") &&
    (!item.provenance.evidence || typeof item.provenance.evidence === "string")
  );
};

const isMatchTier = (value: unknown): value is MatchTier =>
  Object.values(MatchTier).includes(value as MatchTier);

const isUnresolvedField = (value: unknown): value is UnresolvedField => {
  if (!value || typeof value !== "object") return false;
  const entry = value as UnresolvedField;
  return (
    typeof entry.origin === "string" &&
    typeof entry.fieldKey === "string" &&
    typeof entry.normalisedLabel === "string" &&
    typeof entry.kind === "string" &&
    (!entry.autocomplete || typeof entry.autocomplete === "string") &&
    Array.isArray(entry.tiersTried) &&
    entry.tiersTried.every(isMatchTier) &&
    (entry.certainty === "unknown" || entry.certainty === "ambiguous") &&
    typeof entry.count === "number" &&
    typeof entry.lastSeenAt === "string"
  );
};

export const isLocalDataExport = (value: unknown): value is LocalDataExport => {
  if (!value || typeof value !== "object") return false;
  const data = value as LocalDataExport;
  return (
    data.schemaVersion === LOCAL_EXPORT_SCHEMA_VERSION &&
    typeof data.exportedAt === "string" &&
    Array.isArray(data.memory) &&
    data.memory.every(isMemoryItem) &&
    Array.isArray(data.journal) &&
    data.journal.every(isUnresolvedField)
  );
};

const matchesQuery = (item: MemoryItem, query: MemoryQuery): boolean => {
  if (item.profileId !== query.profileId) return false;
  if (query.keys && !query.keys.includes(item.key)) return false;
  if (query.prefix && !item.key.startsWith(query.prefix)) return false;
  if (
    query.minConfidence !== undefined &&
    item.provenance.confidence < query.minConfidence
  ) {
    return false;
  }
  if (query.sources && !query.sources.includes(item.provenance.source)) {
    return false;
  }
  if (query.text) {
    const needle = query.text.toLowerCase();
    const haystack = `${item.key} ${item.label ?? ""}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
};

export const createIndexedDbLocalDataStore = async (
  options: IndexedDbLocalDataOptions = {},
): Promise<PersistentLocalDataStore> => {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const conceptIndex = options.conceptIndex ?? ontology;
  const freshnessPolicy =
    options.freshnessPolicy ?? bundledFreshnessDurationPolicy;
  const now = options.now ?? (() => new Date().toISOString());
  const db = await openDatabase(factory);

  const migrate = async (item: MemoryItem): Promise<MemoryItem> => {
    if (item.schemaVersion === CURRENT_MEMORY_SCHEMA_VERSION) return item;
    if (item.schemaVersion !== 1) {
      throw new Error(`Unknown memory schema version ${item.schemaVersion}.`);
    }

    const concept = conceptIndex.byKey(item.key);
    const baseTime = item.provenance.updatedAt || item.provenance.createdAt;
    const migrated = refreshMemoryItemHorizon(
      {
        ...item,
        schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION,
      },
      concept,
      baseTime,
      freshnessPolicy,
    );
    await putMemory(migrated);
    return migrated;
  };

  const getAllMemoryRaw = async (): Promise<MemoryItem[]> => {
    const transaction = db.transaction(MEMORY_STORE, "readonly");
    const store = transaction.objectStore(MEMORY_STORE);
    return requestToPromise(store.getAll() as IDBRequest<MemoryItem[]>);
  };

  const getMemory = async (
    profileId: ProfileId,
    key: MemoryKey,
  ): Promise<MemoryItem | null> => {
    const transaction = db.transaction(MEMORY_STORE, "readonly");
    const store = transaction.objectStore(MEMORY_STORE);
    const result = await requestToPromise(
      store.get([profileId, key]) as IDBRequest<MemoryItem | undefined>,
    );
    return result ? migrate(result) : null;
  };

  const putMemory = async (item: MemoryItem): Promise<void> => {
    const transaction = db.transaction(MEMORY_STORE, "readwrite");
    transaction.objectStore(MEMORY_STORE).put(item);
    await transactionDone(transaction);
  };

  const clearStore = async (storeName: string): Promise<void> => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).clear();
    await transactionDone(transaction);
  };

  return {
    async get(profileId, key) {
      return getMemory(profileId, key);
    },

    async set(item) {
      await putMemory(item);
    },

    async update(profileId, key, value: MemoryValue) {
      const existing = await getMemory(profileId, key);
      if (!existing) {
        throw new Error(`Cannot update "${key}": no existing item.`);
      }
      await putMemory({
        ...existing,
        value,
        provenance: {
          ...existing.provenance,
          updatedAt: now(),
          confirmedByUser: false,
        },
      });
    },

    async delete(profileId: ProfileId, key: MemoryKey) {
      const transaction = db.transaction(MEMORY_STORE, "readwrite");
      transaction.objectStore(MEMORY_STORE).delete([profileId, key]);
      await transactionDone(transaction);
    },

    async search(query) {
      const results = await Promise.all((await getAllMemoryRaw()).map(migrate));
      const filtered = results.filter((item) => matchesQuery(item, query));
      return query.limit ? filtered.slice(0, query.limit) : filtered;
    },

    async allMemory() {
      return Promise.all((await getAllMemoryRaw()).map(migrate));
    },

    async recordUnresolvedField(input, memoryValues) {
      if (containsStoredValue(input.label, memoryValues)) return false;

      const transaction = db.transaction(JOURNAL_STORE, "readwrite");
      const store = transaction.objectStore(JOURNAL_STORE);
      const existing = await requestToPromise(
        store.get(keyOf(input.origin, input.fieldKey)) as IDBRequest<
          UnresolvedField | undefined
        >,
      );

      store.put({
        origin: input.origin,
        fieldKey: input.fieldKey,
        normalisedLabel: normaliseLabel(input.label),
        kind: input.kind,
        autocomplete: input.autocomplete,
        tiersTried: input.tiersTried,
        certainty: input.certainty,
        count: (existing?.count ?? 0) + 1,
        lastSeenAt: input.now,
      });
      await transactionDone(transaction);
      return true;
    },

    async allJournal() {
      const transaction = db.transaction(JOURNAL_STORE, "readonly");
      return requestToPromise(
        transaction.objectStore(JOURNAL_STORE).getAll() as IDBRequest<
          UnresolvedField[]
        >,
      );
    },

    async exportLocalData() {
      return {
        schemaVersion: LOCAL_EXPORT_SCHEMA_VERSION,
        exportedAt: now(),
        memory: await Promise.all((await getAllMemoryRaw()).map(migrate)),
        journal: await requestToPromise(
          db
            .transaction(JOURNAL_STORE, "readonly")
            .objectStore(JOURNAL_STORE)
            .getAll() as IDBRequest<UnresolvedField[]>,
        ),
      };
    },

    async importLocalData(data) {
      if (!isLocalDataExport(data)) {
        throw new Error("Invalid local data export.");
      }

      const transaction = db.transaction(
        [MEMORY_STORE, JOURNAL_STORE],
        "readwrite",
      );
      const memory = transaction.objectStore(MEMORY_STORE);
      const journal = transaction.objectStore(JOURNAL_STORE);
      memory.clear();
      journal.clear();
      for (const item of data.memory) memory.put(item);
      for (const entry of data.journal) journal.put(entry);
      await transactionDone(transaction);
    },

    async wipeLocalData() {
      await clearStore(MEMORY_STORE);
      await clearStore(JOURNAL_STORE);
    },
  };
};

export const createDefaultIndexedDbLocalDataStore = () =>
  createIndexedDbLocalDataStore({
    conceptIndex: ontology,
    freshnessPolicy: bundledFreshnessDurationPolicy,
  });
