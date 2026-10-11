import { describe, expect, it } from "bun:test";
import {
  createNotificationReminderStore,
  isNotificationReminderPaused,
  notificationReminderPauseUntil,
} from "~/lib/notification-reminders";

const createStorage = (initial: Record<string, unknown> = {}) => {
  const records = { ...initial };
  return {
    records,
    storage: {
      async get(key: string) {
        return { [key]: records[key] };
      },
      async set(values: Record<string, unknown>) {
        Object.assign(records, values);
      },
    },
  };
};

describe("notification reminder preferences", () => {
  it("loads the default pause preferences when nothing is stored", async () => {
    const { storage } = createStorage();

    await expect(
      createNotificationReminderStore(storage).load(),
    ).resolves.toEqual({
      pausedUntilIso: null,
      defaultPauseHours: 2,
    });
  });

  it("persists valid default pause durations", async () => {
    const { storage } = createStorage();
    const store = createNotificationReminderStore(storage);

    await expect(store.setDefaultPauseHours(6)).resolves.toEqual({
      pausedUntilIso: null,
      defaultPauseHours: 6,
    });
    await expect(store.load()).resolves.toEqual({
      pausedUntilIso: null,
      defaultPauseHours: 6,
    });
  });

  it("marks reminders paused until the future timestamp", async () => {
    const nowMs = Date.UTC(2026, 0, 1, 10, 0, 0);
    const { storage } = createStorage();
    const store = createNotificationReminderStore(storage);

    const saved = await store.pauseForHours(8, nowMs);

    expect(saved.pausedUntilIso).toBe("2026-01-01T18:00:00.000Z");
    expect(
      isNotificationReminderPaused(saved, "2026-01-01T17:59:59.000Z"),
    ).toBe(true);
  });

  it("does not treat an expired pause as active", () => {
    expect(
      isNotificationReminderPaused(
        {
          pausedUntilIso: "2026-01-01T12:00:00.000Z",
          defaultPauseHours: 2,
        },
        "2026-01-01T12:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("computes pause-until timestamps from the requested duration", () => {
    expect(notificationReminderPauseUntil(2, Date.UTC(2026, 0, 1))).toBe(
      "2026-01-01T02:00:00.000Z",
    );
  });
});
