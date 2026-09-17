import { DEFAULT_SFX_VOLUME } from "./events";

export interface SoundPreferences {
  readonly enabled: boolean;
  readonly volume: number;
}

export interface AsyncKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const SOUND_PREFERENCES_KEY = "fill-my-form:sound";

export const defaultSoundPreferences: SoundPreferences = {
  enabled: true,
  volume: DEFAULT_SFX_VOLUME,
};

const clampVolume = (value: unknown): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SFX_VOLUME;
  return Math.min(1, Math.max(0, numeric));
};

const isSoundPreferences = (value: unknown): value is SoundPreferences => {
  if (!value || typeof value !== "object") return false;
  const prefs = value as Partial<SoundPreferences>;
  return typeof prefs.enabled === "boolean" && typeof prefs.volume === "number";
};

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

const localStorageAdapter = (): AsyncKeyValueStorage | null => {
  if (typeof window === "undefined" || !window.localStorage) return null;
  return {
    getItem: async (key) => window.localStorage.getItem(key),
    setItem: async (key, value) => window.localStorage.setItem(key, value),
  };
};

export const createSoundPreferenceStore = (
  storage: AsyncKeyValueStorage | null = null,
) => {
  const adapter = storage ?? localStorageAdapter();

  return {
    async load(): Promise<SoundPreferences> {
      const ext = extensionStorage();
      try {
        if (ext) {
          const record = await ext.get(SOUND_PREFERENCES_KEY);
          const value = record[SOUND_PREFERENCES_KEY];
          if (isSoundPreferences(value)) {
            return {
              enabled: value.enabled,
              volume: clampVolume(value.volume),
            };
          }
        }

        const raw = await adapter?.getItem(SOUND_PREFERENCES_KEY);
        if (!raw) return defaultSoundPreferences;
        const parsed = JSON.parse(raw) as unknown;
        return isSoundPreferences(parsed)
          ? { enabled: parsed.enabled, volume: clampVolume(parsed.volume) }
          : defaultSoundPreferences;
      } catch {
        return defaultSoundPreferences;
      }
    },

    async save(preferences: SoundPreferences): Promise<void> {
      const value = {
        enabled: preferences.enabled,
        volume: clampVolume(preferences.volume),
      };

      const ext = extensionStorage();
      if (ext) {
        await ext.set({ [SOUND_PREFERENCES_KEY]: value });
        return;
      }

      await adapter?.setItem(SOUND_PREFERENCES_KEY, JSON.stringify(value));
    },
  };
};
