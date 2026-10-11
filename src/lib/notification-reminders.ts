export const NOTIFICATION_REMINDER_PAUSE_HOURS = [2, 6, 8] as const;

export type NotificationReminderPauseHours =
  (typeof NOTIFICATION_REMINDER_PAUSE_HOURS)[number];

export interface NotificationReminderPreferences {
  readonly pausedUntilIso: string | null;
  readonly defaultPauseHours: NotificationReminderPauseHours;
}

type WebExtensionStorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
};

const STORAGE_KEY = "fill-my-form:notification-reminders";

export const defaultNotificationReminderPreferences: NotificationReminderPreferences =
  {
    pausedUntilIso: null,
    defaultPauseHours: 2,
  };

export const isNotificationReminderPauseHours = (
  value: unknown,
): value is NotificationReminderPauseHours =>
  typeof value === "number" &&
  NOTIFICATION_REMINDER_PAUSE_HOURS.includes(
    value as NotificationReminderPauseHours,
  );

const extensionStorage = (): WebExtensionStorageArea | null => {
  const host = globalThis as typeof globalThis & {
    browser?: { storage?: { local?: WebExtensionStorageArea } };
    chrome?: { storage?: { local?: WebExtensionStorageArea } };
  };

  return host.browser?.storage?.local ?? host.chrome?.storage?.local ?? null;
};

const parsePreferences = (value: unknown): NotificationReminderPreferences => {
  if (!value || typeof value !== "object") {
    return defaultNotificationReminderPreferences;
  }

  const record = value as Partial<NotificationReminderPreferences>;
  return {
    pausedUntilIso:
      typeof record.pausedUntilIso === "string" ? record.pausedUntilIso : null,
    defaultPauseHours: isNotificationReminderPauseHours(
      record.defaultPauseHours,
    )
      ? record.defaultPauseHours
      : defaultNotificationReminderPreferences.defaultPauseHours,
  };
};

export const isNotificationReminderPaused = (
  preferences: NotificationReminderPreferences,
  nowIso: string,
): boolean =>
  Boolean(preferences.pausedUntilIso && preferences.pausedUntilIso > nowIso);

export const notificationReminderPauseUntil = (
  hours: NotificationReminderPauseHours,
  nowMs = Date.now(),
): string => new Date(nowMs + hours * 60 * 60 * 1000).toISOString();

export const createNotificationReminderStore = (
  storage: WebExtensionStorageArea | null = extensionStorage(),
) => ({
  async load(): Promise<NotificationReminderPreferences> {
    try {
      if (!storage) return defaultNotificationReminderPreferences;
      const record = await storage.get(STORAGE_KEY);
      return parsePreferences(record[STORAGE_KEY]);
    } catch {
      return defaultNotificationReminderPreferences;
    }
  },

  async save(preferences: NotificationReminderPreferences): Promise<void> {
    if (!storage) return;
    await storage.set({
      [STORAGE_KEY]: parsePreferences(preferences),
    });
  },

  async setDefaultPauseHours(
    defaultPauseHours: NotificationReminderPauseHours,
  ): Promise<NotificationReminderPreferences> {
    const current = await this.load();
    const next = { ...current, defaultPauseHours };
    await this.save(next);
    return next;
  },

  async pauseForHours(
    hours: NotificationReminderPauseHours,
    nowMs = Date.now(),
  ): Promise<NotificationReminderPreferences> {
    const current = await this.load();
    const next = {
      ...current,
      pausedUntilIso: notificationReminderPauseUntil(hours, nowMs),
    };
    await this.save(next);
    return next;
  },

  async clearPause(): Promise<NotificationReminderPreferences> {
    const current = await this.load();
    const next = { ...current, pausedUntilIso: null };
    await this.save(next);
    return next;
  },
});
