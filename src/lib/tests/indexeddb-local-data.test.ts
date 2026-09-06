import { describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { FieldKind } from "~/core/form/types";
import { MatchTier } from "~/core/matching/types";
import {
  CURRENT_MEMORY_SCHEMA_VERSION,
  DEFAULT_PROFILE_ID,
} from "~/core/memory/types";
import {
  memoryItem,
  runMemoryStoreContract,
} from "~/core/tests/memory-store-contract";
import { createIndexedDbLocalDataStore } from "~/lib/indexeddb-local-data";

const createFactory = (): IDBFactory => new IDBFactory();

runMemoryStoreContract("createIndexedDbLocalDataStore", () => {
  let clock = "2026-01-01T00:00:00.000Z";
  const store = createIndexedDbLocalDataStore({
    indexedDB: createFactory(),
    now: () => clock,
  });
  clock = "2026-02-01T00:00:00.000Z";
  return store;
});

describe("createIndexedDbLocalDataStore: migration", () => {
  it("derives expiresAt for schema v1 volatile items on next read", async () => {
    const store = await createIndexedDbLocalDataStore({
      indexedDB: createFactory(),
    });

    await store.set({
      ...memoryItem({
        key: "employment.current.company",
        value: "Kirloskar Systems",
        schemaVersion: 1,
        provenance: {
          ...memoryItem().provenance,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    });

    const migrated = await store.get(
      DEFAULT_PROFILE_ID,
      "employment.current.company",
    );

    expect(migrated?.schemaVersion).toBe(CURRENT_MEMORY_SCHEMA_VERSION);
    expect(migrated?.provenance.expiresAt).toBe("2026-07-01T00:00:00.000Z");
    expect(
      (await store.get(DEFAULT_PROFILE_ID, "employment.current.company"))
        ?.provenance.expiresAt,
    ).toBe("2026-07-01T00:00:00.000Z");
  });

  it("keeps schema v1 permanent concepts without expiresAt", async () => {
    const store = await createIndexedDbLocalDataStore({
      indexedDB: createFactory(),
    });

    await store.set(
      memoryItem({
        key: "identity.date_of_birth",
        value: "1995-06-01",
        schemaVersion: 1,
      }),
    );

    const migrated = await store.get(
      DEFAULT_PROFILE_ID,
      "identity.date_of_birth",
    );
    expect(migrated?.schemaVersion).toBe(CURRENT_MEMORY_SCHEMA_VERSION);
    expect(migrated?.provenance.expiresAt).toBeUndefined();
    expect(migrated?.provenance.freshnessRule).toBe("permanent");
  });
});

describe("createIndexedDbLocalDataStore: export/import/wipe", () => {
  it("round-trips memory and journal data", async () => {
    const factory = createFactory();
    const store = await createIndexedDbLocalDataStore({ indexedDB: factory });
    await store.set(memoryItem());
    await store.recordUnresolvedField(
      {
        origin: "http://localhost:4173",
        fieldKey: "0/year/0",
        label: "Joining year",
        kind: FieldKind.TEXT,
        tiersTried: [MatchTier.AUTOCOMPLETE, MatchTier.ALIAS],
        certainty: "unknown",
        now: "2026-01-01T00:00:00.000Z",
      },
      [],
    );

    const exported = await store.exportLocalData();
    await store.wipeLocalData();
    expect(await store.allMemory()).toEqual([]);
    expect(await store.allJournal()).toEqual([]);

    await store.importLocalData(exported);

    expect((await store.allMemory()).map((item) => item.key)).toEqual([
      "contact.email",
    ]);
    expect((await store.allJournal()).map((entry) => entry.fieldKey)).toEqual([
      "0/year/0",
    ]);
  });

  it("screens journal labels against stored memory values", async () => {
    const store = await createIndexedDbLocalDataStore({
      indexedDB: createFactory(),
    });

    const wrote = await store.recordUnresolvedField(
      {
        origin: "https://example.com",
        fieldKey: "0/email/0",
        label: "Confirm ananya@example.com",
        kind: FieldKind.TEXT,
        tiersTried: [MatchTier.ALIAS],
        certainty: "unknown",
        now: "2026-01-01T00:00:00.000Z",
      },
      ["ananya@example.com"],
    );

    expect(wrote).toBe(false);
    expect(await store.allJournal()).toEqual([]);
  });
});
