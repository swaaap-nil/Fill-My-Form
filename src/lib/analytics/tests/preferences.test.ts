import { describe, expect, it } from "bun:test";
import { createAnalyticsPreferenceStore } from "../preferences";

const withExtensionStorage = async <T>(
  initial: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> => {
  const records = { ...initial };
  const host = globalThis as typeof globalThis & {
    browser?: unknown;
  };
  host.browser = {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: records[key] };
        },
        async set(values: Record<string, unknown>) {
          Object.assign(records, values);
        },
      },
    },
  };
  try {
    return await run();
  } finally {
    host.browser = undefined;
  }
};

describe("analytics preference store", () => {
  it("defaults to enabled when nothing is stored", async () => {
    await withExtensionStorage({}, async () => {
      await expect(createAnalyticsPreferenceStore().load()).resolves.toBe(true);
    });
  });

  it("persists an opt-out", async () => {
    await withExtensionStorage({}, async () => {
      const store = createAnalyticsPreferenceStore();
      await store.save(false);
      await expect(store.load()).resolves.toBe(false);
    });
  });
});
