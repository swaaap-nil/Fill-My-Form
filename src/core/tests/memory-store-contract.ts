import { describe, expect, it } from "bun:test";
import type { MemoryStore } from "~/core/memory/store";
import {
  CURRENT_MEMORY_SCHEMA_VERSION,
  DEFAULT_PROFILE_ID,
  type MemoryItem,
  MemorySource,
} from "~/core/memory/types";

export const memoryItem = (
  overrides: Partial<MemoryItem> = {},
): MemoryItem => ({
  profileId: DEFAULT_PROFILE_ID,
  key: "contact.email",
  value: "ananya@example.com",
  label: "Email address",
  schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION,
  provenance: {
    source: MemorySource.USER_PROVIDED,
    confidence: 1,
    confirmedByUser: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  ...overrides,
});

export const runMemoryStoreContract = (
  name: string,
  createStore: () => Promise<MemoryStore> | MemoryStore,
) => {
  describe(`${name}: get/set/delete`, () => {
    it("returns null for a key that was never set", async () => {
      const store = await createStore();
      expect(await store.get(DEFAULT_PROFILE_ID, "contact.email")).toBeNull();
    });

    it("set then get round-trips the item exactly", async () => {
      const store = await createStore();
      await store.set(memoryItem());
      expect(await store.get(DEFAULT_PROFILE_ID, "contact.email")).toEqual(
        memoryItem(),
      );
    });

    it("set overwrites an existing item for the same profile and key", async () => {
      const store = await createStore();
      await store.set(memoryItem({ value: "old@example.com" }));
      await store.set(memoryItem({ value: "new@example.com" }));

      const result = await store.get(DEFAULT_PROFILE_ID, "contact.email");
      expect(result?.value).toBe("new@example.com");
    });

    it("delete removes the item; delete of a missing key is a no-op", async () => {
      const store = await createStore();
      await store.set(memoryItem());
      await store.delete(DEFAULT_PROFILE_ID, "contact.email");
      expect(await store.get(DEFAULT_PROFILE_ID, "contact.email")).toBeNull();

      await store.delete(DEFAULT_PROFILE_ID, "contact.email");
    });
  });

  describe(`${name}: update`, () => {
    it("updates only the value, bumping updatedAt from the injected clock", async () => {
      const store = await createStore();
      await store.set(memoryItem());

      await store.update(
        DEFAULT_PROFILE_ID,
        "contact.email",
        "new@example.com",
      );

      const result = await store.get(DEFAULT_PROFILE_ID, "contact.email");
      expect(result?.value).toBe("new@example.com");
      expect(result?.provenance.updatedAt).toBe("2026-02-01T00:00:00.000Z");
      expect(result?.provenance.createdAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("resets confirmedByUser to false: a changed value is no longer the confirmed one", async () => {
      const store = await createStore();
      await store.set(
        memoryItem({
          provenance: { ...memoryItem().provenance, confirmedByUser: true },
        }),
      );

      await store.update(
        DEFAULT_PROFILE_ID,
        "contact.email",
        "new@example.com",
      );

      const result = await store.get(DEFAULT_PROFILE_ID, "contact.email");
      expect(result?.provenance.confirmedByUser).toBe(false);
    });

    it("throws when updating a key that was never set", async () => {
      const store = await createStore();
      await expect(
        store.update(DEFAULT_PROFILE_ID, "contact.email", "x"),
      ).rejects.toThrow();
    });
  });

  describe(`${name}: profile isolation`, () => {
    it("keeps two profiles' values for the same key independent", async () => {
      const store = await createStore();
      await store.set(
        memoryItem({ profileId: "self", value: "self@example.com" }),
      );
      await store.set(
        memoryItem({ profileId: "spouse", value: "spouse@example.com" }),
      );

      expect((await store.get("self", "contact.email"))?.value).toBe(
        "self@example.com",
      );
      expect((await store.get("spouse", "contact.email"))?.value).toBe(
        "spouse@example.com",
      );
    });

    it("search is scoped to the profile in the query", async () => {
      const store = await createStore();
      await store.set(memoryItem({ profileId: "self" }));
      await store.set(
        memoryItem({ profileId: "spouse", key: "identity.first_name" }),
      );

      const results = await store.search({ profileId: "self" });
      expect(results.map((r) => r.key)).toEqual(["contact.email"]);
    });
  });

  describe(`${name}: search`, () => {
    const seed = async () => {
      const store = await createStore();
      await store.set(
        memoryItem({
          key: "identity.first_name",
          label: "First name",
          value: "Ananya",
          provenance: {
            ...memoryItem().provenance,
            confidence: 1,
            source: MemorySource.USER_PROVIDED,
          },
        }),
      );
      await store.set(
        memoryItem({
          key: "education.secondary.completion_year",
          label: "Class 10 completion year",
          value: "2015",
          provenance: {
            ...memoryItem().provenance,
            confidence: 0.5,
            source: MemorySource.INFERRED,
          },
        }),
      );
      await store.set(
        memoryItem({
          key: "education.undergraduate.completion_year",
          label: "Undergraduate completion year",
          value: "2020",
          provenance: {
            ...memoryItem().provenance,
            confidence: 0.9,
            source: MemorySource.OBSERVED,
          },
        }),
      );
      return store;
    };

    it("filters by keys", async () => {
      const store = await seed();
      const results = await store.search({
        profileId: DEFAULT_PROFILE_ID,
        keys: ["identity.first_name"],
      });
      expect(results.map((r) => r.key)).toEqual(["identity.first_name"]);
    });

    it("filters by dotted prefix", async () => {
      const store = await seed();
      const results = await store.search({
        profileId: DEFAULT_PROFILE_ID,
        prefix: "education.",
      });
      expect(results.map((r) => r.key).sort()).toEqual([
        "education.secondary.completion_year",
        "education.undergraduate.completion_year",
      ]);
    });

    it("filters by free text against key and label", async () => {
      const store = await seed();
      const results = await store.search({
        profileId: DEFAULT_PROFILE_ID,
        text: "completion year",
      });
      expect(results.length).toBe(2);

      const byKeyText = await store.search({
        profileId: DEFAULT_PROFILE_ID,
        text: "first_name",
      });
      expect(byKeyText.map((r) => r.key)).toEqual(["identity.first_name"]);
    });

    it("filters by minimum confidence", async () => {
      const store = await seed();
      const results = await store.search({
        profileId: DEFAULT_PROFILE_ID,
        minConfidence: 0.9,
      });
      expect(results.map((r) => r.key).sort()).toEqual([
        "education.undergraduate.completion_year",
        "identity.first_name",
      ]);
    });

    it("filters by source", async () => {
      const store = await seed();
      const results = await store.search({
        profileId: DEFAULT_PROFILE_ID,
        sources: [MemorySource.INFERRED],
      });
      expect(results.map((r) => r.key)).toEqual([
        "education.secondary.completion_year",
      ]);
    });

    it("limits results", async () => {
      const store = await seed();
      const results = await store.search({
        profileId: DEFAULT_PROFILE_ID,
        limit: 1,
      });
      expect(results.length).toBe(1);
    });

    it("combines filters (AND, not OR)", async () => {
      const store = await seed();
      const results = await store.search({
        profileId: DEFAULT_PROFILE_ID,
        prefix: "education.",
        minConfidence: 0.9,
      });
      expect(results.map((r) => r.key)).toEqual([
        "education.undergraduate.completion_year",
      ]);
    });

    it("returns everything for a query with no filters beyond profile", async () => {
      const store = await seed();
      const results = await store.search({ profileId: DEFAULT_PROFILE_ID });
      expect(results.length).toBe(3);
    });
  });
};
