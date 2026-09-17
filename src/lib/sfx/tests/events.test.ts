import { describe, expect, it } from "bun:test";
import { getPlaybackMode } from "uisfx";
import { isKnownCue, isLoopEvent, SFX_EVENT_CUES } from "~/lib/sfx/events";

describe("SFX event mapping", () => {
  it("maps every product event to a valid uisfx cue", () => {
    for (const cue of Object.values(SFX_EVENT_CUES)) {
      expect(isKnownCue(cue)).toBe(true);
    }
  });

  it("marks only loop-backed semantic events as loops", () => {
    for (const event of Object.keys(SFX_EVENT_CUES) as Array<
      keyof typeof SFX_EVENT_CUES
    >) {
      expect(isLoopEvent(event)).toBe(
        getPlaybackMode(SFX_EVENT_CUES[event]) === "loop",
      );
    }
  });
});
