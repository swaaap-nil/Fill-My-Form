import { describe, expect, it } from "bun:test";
import { createSoundPreferenceStore } from "~/lib/sfx/preferences";

const createStorage = (initial: Record<string, string> = {}) => {
  const records = { ...initial };
  return {
    records,
    storage: {
      async getItem(key: string) {
        return records[key] ?? null;
      },
      async setItem(key: string, value: string) {
        records[key] = value;
      },
    },
  };
};

describe("sound preference store", () => {
  it("falls back to enabled default preferences when nothing is stored", async () => {
    const { storage } = createStorage();

    await expect(createSoundPreferenceStore(storage).load()).resolves.toEqual({
      enabled: true,
      volume: 1.0,
    });
  });

  it("persists enabled state and volume", async () => {
    const { records, storage } = createStorage();
    const store = createSoundPreferenceStore(storage);

    await store.save({ enabled: false, volume: 0.35 });

    expect(JSON.parse(Object.values(records)[0] ?? "")).toEqual({
      enabled: false,
      volume: 0.35,
    });
    await expect(store.load()).resolves.toEqual({
      enabled: false,
      volume: 0.35,
    });
  });

  it("clamps stored volume", async () => {
    const { storage } = createStorage({
      "fill-my-form:sound": JSON.stringify({ enabled: true, volume: 2 }),
    });

    await expect(createSoundPreferenceStore(storage).load()).resolves.toEqual({
      enabled: true,
      volume: 1,
    });
  });
});
