import { describe, expect, it } from "bun:test";
import {
  clearDetectionBadge,
  DETECTION_BADGE_TEXT,
  setDetectionBadge,
} from "~/lib/detection-nudge";

describe("setDetectionBadge", () => {
  it("sets per-tab badge text and background", async () => {
    const calls: unknown[] = [];
    const browser = {
      action: {
        setBadgeText: async (details: unknown) => {
          calls.push(["text", details]);
        },
        setBadgeBackgroundColor: async (details: unknown) => {
          calls.push(["color", details]);
        },
      },
    };

    await setDetectionBadge(browser, 42);

    expect(calls).toEqual([
      ["text", { text: DETECTION_BADGE_TEXT, tabId: 42 }],
      ["color", { color: "#059669", tabId: 42 }],
    ]);
  });

  it("no-ops when action API is missing", async () => {
    await expect(setDetectionBadge({}, 1)).resolves.toBeUndefined();
  });
});

describe("clearDetectionBadge", () => {
  it("clears per-tab badge text", async () => {
    let cleared: unknown;
    const browser = {
      action: {
        setBadgeText: async (details: unknown) => {
          cleared = details;
        },
      },
    };

    await clearDetectionBadge(browser, 7);
    expect(cleared).toEqual({ text: "", tabId: 7 });
  });
});
