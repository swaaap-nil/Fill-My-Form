import { describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createIndexedDbFileReferenceStore } from "~/lib/files/adapters";

describe("temporary file artifacts", () => {
  it("keeps the original immutable and purges expired derived copies", async () => {
    const store = await createIndexedDbFileReferenceStore(new IDBFactory());
    const original = new File(["original-bytes"], "photo.png", {
      type: "image/png",
    });
    const originalRef = await store.save(original, "2026-01-01T00:00:00.000Z");
    const derived = await store.saveDerived(
      new File(["prepared-bytes"], "photo.jpg", { type: "image/jpeg" }),
      originalRef,
      "2026-01-01T00:00:00.000Z",
      60_000,
    );

    expect(derived.artifactKind).toBe("derived");
    expect(derived.derivedFrom).toBe(originalRef.id);
    expect(await (await store.get(originalRef.id))?.blob.text()).toBe(
      "original-bytes",
    );

    expect(await store.purgeExpired("2026-01-01T00:00:59.000Z")).toBe(0);
    expect(await store.purgeExpired("2026-01-01T00:01:01.000Z")).toBe(1);
    expect(await store.get(originalRef.id)).not.toBeNull();
    expect(await store.get(derived.id)).toBeNull();
  });
});
