import type { SfxEvent } from "~/lib/sfx/events";
import { analyticsClient } from "./client";
import { ANALYTICS_TRACKED_EVENTS, type AnalyticsFields } from "./events";
import { createAnalyticsPreferenceStore } from "./preferences";

const preferenceStore = createAnalyticsPreferenceStore();

// Cached after first load so every track() call isn't a storage round-trip;
// refreshed whenever the toggle changes (see setAnalyticsEnabled).
let cachedEnabled: boolean | null = null;

const isEnabled = async (): Promise<boolean> => {
  if (cachedEnabled === null) cachedEnabled = await preferenceStore.load();
  return cachedEnabled;
};

export const setAnalyticsEnabled = async (enabled: boolean): Promise<void> => {
  cachedEnabled = enabled;
  await preferenceStore.save(enabled);
};

/**
 * Records one product-usage event. A no-op when analytics isn't configured
 * (no VITE_OPENPANEL_CLIENT_ID), when the event isn't in the tracked
 * allowlist, or when the user has opted out. Fire-and-forget: a tracking
 * failure must never surface to the caller or affect the fill flow.
 */
export const track = (event: SfxEvent, fields?: AnalyticsFields): void => {
  const client = analyticsClient;
  if (!client || !ANALYTICS_TRACKED_EVENTS.has(event)) return;

  void isEnabled().then((enabled) => {
    if (!enabled) return;
    try {
      client.track(event, fields ? { ...fields } : undefined);
    } catch {
      // Analytics must never break the product it's measuring.
    }
  });
};
