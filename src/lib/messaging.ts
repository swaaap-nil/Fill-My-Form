import { defineExtensionMessaging } from "@webext-core/messaging";
import type { AgentPhase, AgentStatus } from "~/core/agent/types";
import type { DecisionId, FieldProposal } from "~/core/fill/types";
import type {
  FieldConstraint,
  FieldId,
  Form,
  UploadIntent,
} from "~/core/form/types";
import type {
  FileReference,
  MemoryItem,
  MemoryKey,
  MemoryValue,
} from "~/core/memory/types";
import type {
  FillFieldPayload,
  UploadFilePayload,
} from "~/core/messaging/fill-instruction";
import type { VerificationResult } from "~/core/verification/types";
import type { LocalDataExport } from "./indexeddb-local-data";

/**
 * The panel <-> background <-> content-script protocol.
 *
 * **One rule that must survive every change to this file:** page writes are
 * background-originated only. The content script validates the payload shape
 * before touching the DOM, while the background keeps the actual capability:
 * straight-line fills must match a live, tab-bound pending decision that is
 * consumed after use; agent-loop fills are emitted by the reviewed loop
 * ports after policy has run.
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
export type {
  FillFieldPayload,
  UploadFilePayload,
} from "~/core/messaging/fill-instruction";
export {
  assertValidFillInstruction,
  assertValidUploadInstruction,
  fillFieldPayloadSchema,
  uploadFilePayloadSchema,
} from "~/core/messaging/fill-instruction";

export interface RunFillResult {
  readonly granted: boolean;
  readonly proposals: readonly FieldProposal[];
  readonly uploadIntents: readonly UploadIntent[];
}

export interface ConfirmFillOutcome {
  readonly decisionId: DecisionId;
  readonly ok: boolean;
}

/**
 * What the panel needs to render one agent-loop run — a purpose-built
 * projection of `RunSnapshot` (`~/core/agent/loop`), not the snapshot
 * itself: the panel has no business seeing `matches`/`handled`/internal
 * step history, only what it must show or act on next.
 */
export interface RunView {
  readonly runId: string;
  readonly phase: AgentPhase;
  readonly status: AgentStatus;
  readonly pendingQuestion?: string;
  readonly pendingInput?:
    | { readonly kind: "text" }
    | {
        readonly kind: "file";
        readonly fieldId: FieldId;
        readonly label?: string;
        readonly accept?: readonly string[];
        readonly constraints: readonly FieldConstraint[];
      };
  readonly review: {
    readonly fieldId: FieldId;
    readonly value: string;
    readonly label?: string;
  } | null;
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
  deleteOnboardingAnswer(data: { key: MemoryKey }): { ok: boolean };
  getMemorySnapshot(): { items: readonly MemoryItem[] };
  exportLocalData(): { data: LocalDataExport };
  importLocalData(data: { payload: unknown }): { ok: boolean };
  wipeLocalData(): { ok: boolean };

  // Panel -> background: the Phase 2 agent loop, alongside (not replacing)
  // the straight-line runFill/confirmFill above. Starts a run for the tab if
  // none is in progress, or drives an existing one (persisted in
  // `chrome.storage.session`, see `~/lib/agent-runs`) as far as it can go.
  startRun(data: { tabId: number }): { started: boolean; view: RunView | null };
  getRunState(data: { tabId: number }): { view: RunView | null };
  answerRunQuestion(data: { tabId: number; value: string | FileReference }): {
    ok: boolean;
    view: RunView | null;
  };
  confirmRunReview(data: { tabId: number; approve: boolean }): {
    ok: boolean;
    view: RunView | null;
  };

  // Background -> content script (sent with a tabId).
  extractFullForm(): { forms: readonly Form[] };
  fillField(data: FillFieldPayload): { ok: boolean };
  uploadFile(data: UploadFilePayload): { ok: boolean };
  showFillFeedback(data: { filledCount: number }): { ok: boolean };
  showFormDetectionNudge(data: {
    knownFieldCount: number;
    answerCount: number;
  }): { ok: boolean };
  verifyField(data: {
    fieldId: FieldId;
    expectedValue: string;
  }): VerificationResult;

  /** Content script → background: generic form heuristic fired (no field values). */
  formPageDetected(data: { url: string; reason: string; generation: string }): {
    ack: boolean;
  };

  /** Content script → background: may this page run passive detection? */
  getPageAccessForUrl(data: { url: string }): { mayDetect: boolean };

  /** Background → content script: ack so detection can fire again after navigation. */
  ackFormPageDetected(data: { generation: string }): { ok: boolean };

  /** Content script → background: open fill UI from in-page detection banner (user gesture). */
  openFillUiFromTab(): { opened: boolean };
}

export const { sendMessage, onMessage } = defineExtensionMessaging<Messages>();
