import { describe, expect, it } from "bun:test";
import { getPlaybackMode } from "uisfx";
import { isLoopEvent, SFX_EVENT_CUES } from "~/lib/sfx/events";

describe("SFX event mapping", () => {
  // No "every event maps to a valid uisfx cue" test here: SFX_EVENT_CUES is
  // declared `as const satisfies Record<string, CueName>`, so an invalid
  // cue is already a compile error — a runtime test of it would only
  // restate what `tsc` guarantees.

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
