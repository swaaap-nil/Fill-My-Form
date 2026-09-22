/**
 * The analytics opt-out toggle. Defaults to enabled: the tracked schema is
 * anonymous and aggregate by construction (docs/adr/010-product-analytics.md),
 * matching how docs/privacy.md already classifies "anonymous usage metadata"
 * as cloud-eligible without a separate consent gate.
 */

const ANALYTICS_PREFERENCES_KEY = "fill-my-form:analytics";

export const defaultAnalyticsEnabled = true;

type WebExtensionStorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
};

const extensionStorage = (): WebExtensionStorageArea | null => {
  const host = globalThis as typeof globalThis & {
    browser?: { storage?: { local?: WebExtensionStorageArea } };
    chrome?: { storage?: { local?: WebExtensionStorageArea } };
  };

  return host.browser?.storage?.local ?? host.chrome?.storage?.local ?? null;
};

export const createAnalyticsPreferenceStore = () => ({
  async load(): Promise<boolean> {
    try {
      const ext = extensionStorage();
      if (!ext) return defaultAnalyticsEnabled;
      const record = await ext.get(ANALYTICS_PREFERENCES_KEY);
      const value = record[ANALYTICS_PREFERENCES_KEY];
      return typeof value === "boolean" ? value : defaultAnalyticsEnabled;
    } catch {
      return defaultAnalyticsEnabled;
    }
  },

  async save(enabled: boolean): Promise<void> {
    const ext = extensionStorage();
    if (!ext) return;
    await ext.set({ [ANALYTICS_PREFERENCES_KEY]: enabled });
  },
});
