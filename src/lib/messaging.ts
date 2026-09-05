import { defineExtensionMessaging } from "@webext-core/messaging";
import type { DecisionId, FieldProposal } from "~/core/fill/types";
import type { Form } from "~/core/form/types";
import type { MemoryItem, MemoryKey, MemoryValue } from "~/core/memory/types";
import type { FillFieldPayload } from "~/core/messaging/fill-instruction";

/**
 * The panel <-> background <-> content-script protocol.
 *
 * **One rule that must survive every change to this file:** a fill
 * instruction the content script accepts must carry a `decisionId` the
 * background issued after running `PolicyEngine.evaluate`. Without that,
 * the panel could message the content script directly and policy becomes
 * advisory instead of load-bearing. `~/core/messaging/fill-instruction` is
 * the one place that requirement is enforced and unit-tested, with no
 * browser involved, precisely so this property can never quietly regress.
 *
 * Everything here is a message *shape*; the handlers that back these types
 * live in `src/app/background` (composition root — the only place that
 * holds the `MemoryStore` and the decision map) and `src/app/content`
 * (holds the DOM).
 *
 * **Site access is deliberately not a message.** `chrome.permissions
 * .request()` only succeeds when called synchronously within a user
 * gesture's call stack — a background service worker invoked via
 * `runtime.sendMessage` from that gesture does not inherit it, and the
 * call rejects with "This function must be called during a user gesture".
 * The side panel calls `~/lib/site-access` directly instead, since it is
 * itself a privileged extension page with the same `permissions` and
 * `scripting` API access the background has.
 */
export type { DecisionId, FieldProposal } from "~/core/fill/types";
export type { FillFieldPayload } from "~/core/messaging/fill-instruction";
export {
  assertValidFillInstruction,
  fillFieldPayloadSchema,
} from "~/core/messaging/fill-instruction";

export interface RunFillResult {
  readonly granted: boolean;
  readonly proposals: readonly FieldProposal[];
}

export interface ConfirmFillOutcome {
  readonly decisionId: DecisionId;
  readonly ok: boolean;
}

interface Messages {
  // Panel -> background. `tabId` is resolved by the panel, not
  // re-derived in the background: a service worker has no window of its
  // own, so `chrome.tabs.query({ currentWindow: true })` called from
  // there is ambiguous the moment more than one window is open — it can
  // silently resolve to the wrong tab. The side panel's `currentWindow`
  // is unambiguous (it is attached to a specific window), so it resolves
  // the tab once and passes the id through explicitly.
  runFill(data: { tabId: number }): RunFillResult;
  confirmFill(data: { decisionIds: readonly DecisionId[]; tabId: number }): {
    results: readonly ConfirmFillOutcome[];
  };
  recordOnboardingAnswer(data: {
    key: MemoryKey;
    value: MemoryValue;
    label?: string;
  }): { ok: boolean };
  getMemorySnapshot(): { items: readonly MemoryItem[] };

  // Background -> content script (sent with a tabId).
  extractFullForm(): { forms: readonly Form[] };
  fillField(data: FillFieldPayload): { ok: boolean };
}

export const { sendMessage, onMessage } = defineExtensionMessaging<Messages>();
