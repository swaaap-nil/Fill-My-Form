/**
 * The analytics event taxonomy. See docs/adr/010-product-analytics.md.
 *
 * `ANALYTICS_TRACKED_EVENTS` is a closed allowlist, not "every SfxEvent minus
 * a few" — the same "deliberate, reviewed act" discipline `LogFields` already
 * applies to logging (src/core/logging.ts). Sound-preference meta-events
 * (soundEnabled/soundDisabled/soundVolumeChanged) and memoryTyping (fires on
 * every keystroke) are deliberately excluded: they describe the sound
 * feature or UI noise, not product usage.
 */

import type { SfxEvent } from "~/lib/sfx/events";

export const ANALYTICS_TRACKED_EVENTS: ReadonlySet<SfxEvent> = new Set([
  "sidepanelViewSwitch",
  "scanStarted",
  "scanSucceeded",
  "scanBlocked",
  "scanFailed",
  "fillStarted",
  "fillSucceeded",
  "fillFailed",
  "accessRevoked",
  "agentStarted",
  "agentCompleted",
  "agentFailed",
  "agentAnswerSent",
  "agentReviewConfirmed",
  "agentReviewSkipped",
  "memorySaveSucceeded",
  "memorySaveFailed",
  "fileTagging",
  "fileSourceSelected",
  "fileSelected",
  "filePrepareStarted",
  "filePrepareSucceeded",
  "filePrepareFailed",
  "fileEditorSaved",
  "localDataExported",
  "localDataImported",
  "localDataImportFailed",
  "localDataWiped",
  "localDataWipeFailed",
] satisfies readonly SfxEvent[]);

export const isTrackedEvent = (event: SfxEvent): boolean =>
  ANALYTICS_TRACKED_EVENTS.has(event);

/**
 * Every field permitted on an analytics event. No index signature: an
 * unlisted key (a form value, a label, a full URL) is a type error, not a
 * privacy incident. Adding a field here is a deliberate act reviewed against
 * docs/privacy.md, mirroring `LogFields` in src/core/logging.ts.
 */
export interface AnalyticsFields {
  /** Registrable origin only (e.g. "irctc.co.in") — never a full URL or query string. */
  readonly origin?: string;
  /** BCP-47 locale tag from the browser, e.g. "en-US". */
  readonly locale?: string;
  readonly durationMs?: number;
  readonly count?: number;
  readonly outcome?: "success" | "failure" | "blocked" | "cancelled";
}
