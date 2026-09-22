import { describe, expect, it } from "bun:test";
import { SFX_EVENT_CUES } from "~/lib/sfx/events";
import { ANALYTICS_TRACKED_EVENTS, isTrackedEvent } from "../events";

describe("analytics event taxonomy", () => {
  it("only tracks events that exist in the sound taxonomy", () => {
    const knownEvents = new Set(Object.keys(SFX_EVENT_CUES));
    for (const event of ANALYTICS_TRACKED_EVENTS) {
      expect(knownEvents.has(event)).toBe(true);
    }
  });

  it("excludes high-frequency and sound-preference meta-events", () => {
    expect(isTrackedEvent("memoryTyping")).toBe(false);
    expect(isTrackedEvent("soundEnabled")).toBe(false);
    expect(isTrackedEvent("soundDisabled")).toBe(false);
    expect(isTrackedEvent("soundVolumeChanged")).toBe(false);
  });

  it("tracks the core scan/fill/agent lifecycle", () => {
    expect(isTrackedEvent("scanSucceeded")).toBe(true);
    expect(isTrackedEvent("fillFailed")).toBe(true);
    expect(isTrackedEvent("agentCompleted")).toBe(true);
  });
});
