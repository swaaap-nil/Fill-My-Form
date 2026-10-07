/**
 * Injectable message-handler logic for the composition root
 * (`src/app/background/index.ts`).
 *
 * `index.ts` wires real singletons (the IndexedDB-backed stores, `wxt`'s
 * `browser`, `~/lib/messaging`'s `sendMessage`) into `main()`'s closures —
 * fine for production, impossible to unit test, since importing
 * `~/lib/messaging` unmocked throws outside a real extension context (see
 * `~/lib/form/verify.ts`'s file comment) and the rest touch IndexedDB and
 * `chrome.*` directly. This file is the seam: the same logic, taking its
 * dependencies as parameters, following the constructor-injection pattern
 * `~/lib/site-access.ts` already uses for `browser`. `index.ts` builds the
 * real deps and calls these; `background.test.ts` builds fakes and calls
 * the same functions.
 */

import type { RunSnapshot } from "~/core/agent/loop";
import { currentReview } from "~/core/agent/loop";
import { confirmDecision } from "~/core/fill/driver";
import type { PendingDecisionRegistry } from "~/core/fill/pending-decisions";
import { FieldKind } from "~/core/form/types";
import { deriveFreshnessHorizon } from "~/core/memory/freshness";
import { bundledFreshnessDurationPolicy } from "~/core/memory/freshness-policy";
import type { MemoryStore } from "~/core/memory/store";
import type { FileReference } from "~/core/memory/types";
import { DEFAULT_PROFILE_ID, MemorySource } from "~/core/memory/types";
import { recordAnswer } from "~/core/memory/write-service";
import type { UploadFilePayload } from "~/core/messaging/fill-instruction";
import { ontology } from "~/core/ontology";
import { defaultPolicy } from "~/core/policy/default";
import type { RunView } from "~/lib/messaging";

/** The three outbound messages `confirmFillHandler` sends to the content script. */
export interface ConfirmFillMessaging {
  fillField: (
    data: { decisionId: string; fieldId: string; value: string },
    tabId: number,
  ) => Promise<{ ok: boolean }>;
  uploadFile: (
    data: UploadFilePayload,
    tabId: number,
  ) => Promise<{ ok: boolean }>;
  showFillFeedback: (
    data: { filledCount: number },
    tabId: number,
  ) => Promise<{ ok: boolean } | undefined>;
}

/** The subset of `createBrowserFileComplianceAdapter`'s return value confirmFill uses. */
export interface FillFileAdapter {
  prepareLocalFile(
    ref: FileReference,
    constraints: readonly unknown[],
  ): Promise<{
    readonly name: string;
    readonly mimeType: string;
    readonly blob: Blob;
    readonly temporaryRef?: { readonly id: string };
  } | null>;
  cleanupPreparedFile(ref: { readonly id: string }): Promise<void>;
}

const bytesOf = async (blob: Blob): Promise<number[]> =>
  Array.from(new Uint8Array(await blob.arrayBuffer()));

export interface ConfirmFillDeps {
  readonly memoryStore: MemoryStore;
  readonly files: FillFileAdapter;
  readonly pendingDecisions: Pick<PendingDecisionRegistry, "take">;
  readonly hasSiteAccess: (tabId: number) => Promise<boolean>;
  readonly messaging: ConfirmFillMessaging;
  readonly now?: () => string;
}

export interface ConfirmFillData {
  readonly decisionIds: readonly string[];
  readonly tabId: number;
}

export interface ConfirmFillResult {
  readonly results: ReadonlyArray<{ decisionId: string; ok: boolean }>;
}

/**
 * The `confirmFill` message handler, extracted verbatim from
 * `index.ts`'s original inline `onMessage("confirmFill", ...)` — see that
 * file's git history for the pre-extraction version if a diff is needed.
 */
export const confirmFillHandler = async (
  deps: ConfirmFillDeps,
  data: ConfirmFillData,
): Promise<ConfirmFillResult> => {
  const { memoryStore, files, pendingDecisions, hasSiteAccess, messaging } =
    deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const tabId = data.tabId;

  if (!(await hasSiteAccess(tabId))) {
    return {
      results: data.decisionIds.map((decisionId) => ({
        decisionId,
        ok: false,
      })),
    };
  }

  const results = await Promise.all(
    data.decisionIds.map(async (decisionId) => {
      const decision = pendingDecisions.take(decisionId, tabId);
      if (!decision) return { decisionId, ok: false };

      const outcome = confirmDecision(decision, defaultPolicy);
      if (!outcome.ok) return { decisionId, ok: false };
      if (!(await hasSiteAccess(tabId))) return { decisionId, ok: false };

      let ok = false;
      if (outcome.payload.kind === "file") {
        const prepared = await files.prepareLocalFile(
          outcome.payload.ref,
          decision.constraints ?? [],
        );
        if (prepared) {
          try {
            const result = await messaging.uploadFile(
              {
                decisionId,
                fieldId: outcome.fieldId,
                upload: {
                  name: prepared.name,
                  mimeType: prepared.mimeType,
                  bytes: await bytesOf(prepared.blob),
                },
              },
              tabId,
            );
            ok = result.ok;
          } finally {
            if (prepared.temporaryRef) {
              await files.cleanupPreparedFile(prepared.temporaryRef);
            }
          }
        }
      } else {
        const result = await messaging.fillField(
          {
            decisionId,
            fieldId: outcome.fieldId,
            value: outcome.payload.value,
          },
          tabId,
        );
        ok = result.ok;
      }

      if (ok && outcome.memoryWrite !== false) {
        const memoryKey = outcome.memoryWrite?.key ?? decision.conceptKey;
        const memoryValue =
          outcome.memoryWrite?.value ??
          outcome.memoryValue ??
          (outcome.payload.kind === "text" ? outcome.payload.value : "");
        const concept = ontology.byKey(memoryKey);
        const confirmedAt = now();
        const horizon = concept
          ? deriveFreshnessHorizon(
              concept,
              memoryValue,
              confirmedAt,
              bundledFreshnessDurationPolicy,
            )
          : undefined;
        await recordAnswer(memoryStore, {
          profileId: DEFAULT_PROFILE_ID,
          key: memoryKey,
          value:
            outcome.memoryWrite?.value ??
            (outcome.payload.kind === "text"
              ? memoryValue
              : outcome.payload.ref),
          source: MemorySource.USER_CONFIRMED,
          now: confirmedAt,
          expiresAt: horizon?.expiresAt,
          freshnessRule: horizon?.freshnessRule,
        });
      }

      return { decisionId, ok };
    }),
  );

  const filledCount = results.filter((result) => result.ok).length;
  if (filledCount > 0) {
    await messaging.showFillFeedback({ filledCount }, tabId).catch(() => {});
  }

  return { results };
};

export interface GetMemorySnapshotDeps {
  readonly memoryStore: Pick<MemoryStore, "search">;
}

/** The `getMemorySnapshot` message handler. */
export const getMemorySnapshotHandler = async (
  deps: GetMemorySnapshotDeps,
): Promise<{ items: Awaited<ReturnType<MemoryStore["search"]>> }> => ({
  items: await deps.memoryStore.search({ profileId: DEFAULT_PROFILE_ID }),
});

/**
 * `RunSnapshot` -> the `RunView` the panel actually renders. Pure — no
 * `browser.*`, no messaging — so it needs no seam, only an export. This is
 * the translation `resume.spec.ts` and `verify.spec.ts` only prove
 * end-to-end today; a wrong `pendingInput.kind` for a file field, or a
 * review surfaced when the run isn't actually waiting, is a bug this can
 * now catch in milliseconds instead of a browser round trip.
 */
export const toRunView = (snapshot: RunSnapshot): RunView => ({
  runId: snapshot.run.id,
  phase: snapshot.run.state.phase,
  status: snapshot.run.state.status,
  pendingQuestion: snapshot.run.state.pendingQuestion,
  pendingInput: pendingInputFor(snapshot),
  review: currentReview(snapshot),
});

export const pendingInputFor = (
  snapshot: RunSnapshot,
): RunView["pendingInput"] | undefined => {
  if (
    snapshot.run.state.status !== "waiting_for_user" ||
    snapshot.pendingDecision?.action.type !== "ask_user" ||
    !snapshot.cursor
  ) {
    return undefined;
  }

  const field = snapshot.fields.find(
    (candidate) => candidate.id === snapshot.cursor,
  );
  if (!field || field.kind !== FieldKind.FILE) return { kind: "text" };

  const accept = field.constraints.find(
    (constraint) => constraint.kind === "accept",
  );
  return {
    kind: "file",
    fieldId: field.id,
    label: field.label,
    accept: accept?.value,
    constraints: field.constraints,
  };
};
