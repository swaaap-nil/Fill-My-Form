import { browser } from "wxt/browser";
import { z } from "zod";
import { defineBackground } from "#imports";
import {
  answerQuestion,
  confirmReview,
  createRun,
  currentReview,
  drive,
  FILL_FIELD_TOOL,
  INSPECT_FORM_TOOL,
  type LoopPorts,
  type RunSnapshot,
  UPLOAD_FILE_TOOL,
} from "~/core/agent/loop";
import { Certainty, isTerminal } from "~/core/agent/types";
import { confirmDecision, planFill } from "~/core/fill/driver";
import type { DecisionId, PendingDecision } from "~/core/fill/types";
import { createLogger } from "~/core/logging";
import { resolve } from "~/core/matching/resolve";
import { deriveFreshnessHorizon } from "~/core/memory/freshness";
import { bundledFreshnessDurationPolicy } from "~/core/memory/freshness-policy";
import { DEFAULT_PROFILE_ID, MemorySource } from "~/core/memory/types";
import { recordAnswer } from "~/core/memory/write-service";
import { ontology } from "~/core/ontology";
import { defaultPolicy } from "~/core/policy/default";
import { ActionRisk } from "~/core/policy/types";
import { createToolRegistry } from "~/core/tools/registry";
import { CapabilityDomain } from "~/core/tools/types";
import type { Verifier } from "~/core/verification/types";
import {
  clearRunSnapshot,
  loadRunSnapshot,
  saveRunSnapshot,
} from "~/lib/agent-runs";
import {
  createBrowserFileComplianceAdapter,
  createIndexedDbFileReferenceStore,
  type FileReferenceStore,
} from "~/lib/files/adapters";
import { inspectFormOutputSchema } from "~/lib/form/schema";
import {
  createDefaultIndexedDbLocalDataStore,
  isLocalDataExport,
  type PersistentLocalDataStore,
} from "~/lib/indexeddb-local-data";
import { onMessage, type RunView, sendMessage } from "~/lib/messaging";
import { siteAccess } from "~/lib/site-access";

/**
 * The composition root.
 *
 * The background worker is where the agent runtime will live: it outlives
 * any side panel, so a run — or a value someone just typed in onboarding —
 * survives the panel closing. This is why `memoryStore` and
 * `pendingDecisions` are module-scope state here and nowhere else: the
 * side panel holds no state of its own, only a view onto messages sent
 * here. See docs/agent.md and the phase 1c handback.
 */
const logger = createLogger({ sessionId: crypto.randomUUID() });
let localDataStore: Promise<PersistentLocalDataStore> | undefined;
const getLocalDataStore = (): Promise<PersistentLocalDataStore> => {
  localDataStore ??= createDefaultIndexedDbLocalDataStore();
  return localDataStore;
};

let fileStore: Promise<FileReferenceStore> | undefined;
const getFileStore = (): Promise<FileReferenceStore> => {
  fileStore ??= createIndexedDbFileReferenceStore();
  return fileStore;
};

const bytesOf = async (blob: Blob): Promise<number[]> =>
  Array.from(new Uint8Array(await blob.arrayBuffer()));

const stageUpload = async (file: {
  readonly name: string;
  readonly mimeType: string;
  readonly blob: Blob;
}): Promise<string> => {
  const uploadId = crypto.randomUUID();
  await browser.storage.session.set({
    [`file-upload:${uploadId}`]: {
      name: file.name,
      mimeType: file.mimeType,
      bytes: await bytesOf(file.blob),
    },
  });
  return uploadId;
};

/**
 * decisionId -> what `planFill` decided about one field. Cleared per id
 * once acted on, so a decisionId cannot be replayed. Lives only as long as
 * the service worker does — a run that outlives a worker restart is
 * Phase 2's problem, not this straight-line driver's.
 */
const pendingDecisions = new Map<DecisionId, PendingDecision>();

/**
 * The Phase 2 agent loop's `LoopPorts`, for one tab. Both browser tools are
 * thin wrappers around messages the content script already answers
 * (`extractFullForm`, `fillField`); the only thing added here is the
 * `decisionId` a fill must carry, minted right before the write because this
 * call only happens after the loop's own PLAN step has already run policy —
 * the same trust boundary `~/core/fill/driver`'s `confirmDecision` enforces
 * for the straight-line flow above.
 */
const buildLoopPorts = async (tabId: number): Promise<LoopPorts> => {
  const memoryStore = await getLocalDataStore();
  const files = createBrowserFileComplianceAdapter(await getFileStore());
  const tools = createToolRegistry();

  tools.register({
    name: INSPECT_FORM_TOOL,
    domain: CapabilityDomain.BROWSER,
    description: "Extracts the full field detail for every form on the page.",
    input: z.object({}),
    output: inspectFormOutputSchema,
    risk: ActionRisk.LOW,
    execute: () => sendMessage("extractFullForm", undefined, tabId),
  });

  tools.register({
    name: FILL_FIELD_TOOL,
    domain: CapabilityDomain.BROWSER,
    description: "Writes one resolved value into one page field.",
    input: z.object({ fieldId: z.string(), value: z.string() }),
    output: z.object({ ok: z.boolean() }),
    risk: ActionRisk.MEDIUM,
    execute: (input) =>
      sendMessage(
        "fillField",
        {
          decisionId: crypto.randomUUID(),
          fieldId: input.fieldId,
          value: input.value,
        },
        tabId,
      ),
  });

  tools.register({
    name: UPLOAD_FILE_TOOL,
    domain: CapabilityDomain.FILES,
    description:
      "Uploads one approved local file reference into one page field.",
    input: z.object({
      fieldId: z.string(),
      ref: z.object({
        kind: z.literal("file_ref"),
        id: z.string(),
        name: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number(),
        createdAt: z.string(),
      }),
      constraints: z.array(z.unknown()),
    }),
    output: z.object({ ok: z.boolean() }),
    risk: ActionRisk.MEDIUM,
    execute: async (input) => {
      const prepared = await files.prepareLocalFile(
        input.ref,
        input.constraints as Parameters<typeof files.prepareLocalFile>[1],
      );
      if (!prepared) return { ok: false };
      return sendMessage(
        "uploadFile",
        {
          decisionId: crypto.randomUUID(),
          fieldId: input.fieldId,
          uploadId: await stageUpload(prepared),
        },
        tabId,
      );
    },
  });

  const verifier: Verifier = {
    verify: (intent) =>
      sendMessage(
        "verifyField",
        { fieldId: intent.fieldId, expectedValue: intent.expectedValue },
        tabId,
      ),
  };

  return {
    tools,
    policy: defaultPolicy,
    memory: memoryStore,
    journal: memoryStore,
    files,
    ontology,
    verifier,
    profileId: DEFAULT_PROFILE_ID,
    clock: () => new Date().toISOString(),
    generateId: () => crypto.randomUUID(),
    logger,
  };
};

const toRunView = (snapshot: RunSnapshot): RunView => ({
  runId: snapshot.run.id,
  phase: snapshot.run.state.phase,
  status: snapshot.run.state.status,
  pendingQuestion: snapshot.run.state.pendingQuestion,
  review: currentReview(snapshot),
});

/** Drives a run and persists the result, clearing the snapshot once terminal. */
const driveAndPersist = async (
  snapshot: RunSnapshot,
  ports: LoopPorts,
): Promise<RunSnapshot> => {
  const next = await drive(snapshot, ports);
  if (isTerminal(next.run.state.status)) {
    await clearRunSnapshot(next.tabId);
  } else {
    await saveRunSnapshot(next);
  }
  return next;
};

const main = () => {
  browser.storage.session
    .setAccessLevel?.({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
    .catch((error: unknown) =>
      logger.warn("could not expose session storage to content scripts", {
        errorCode: String(error),
      }),
    );

  // Clicking the toolbar icon opens the side panel. Requires no
  // `action.default_popup` in the manifest, and Chrome only. Firefox has no
  // sidePanel API, so this is feature-detected rather than assumed.
  if (browser.sidePanel) {
    browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) =>
        logger.warn("could not set side panel behavior", {
          errorCode: String(error),
        }),
      );
  } else {
    // Firefox: WXT emits a `sidebar_action` for the built-in sidebar, but
    // that API has no Chrome-style "open on action click" behavior — the
    // `action` (toolbar) button and the sidebar are separate UI, and with
    // no `default_popup` the toolbar button otherwise does nothing when
    // clicked. Wire the two together explicitly via `sidebarAction.toggle`.
    // Not in `@wxt-dev/browser`'s Chrome-derived types, hence the cast.
    const firefoxBrowser = browser as unknown as {
      sidebarAction?: { toggle: () => Promise<void> };
    };
    browser.action.onClicked.addListener(() => {
      firefoxBrowser.sidebarAction
        ?.toggle()
        .catch((error: unknown) =>
          logger.warn("could not toggle sidebar", {
            errorCode: String(error),
          }),
        );
    });
  }

  // Runtime content-script registrations do not survive a browser restart,
  // but the user's permission grants do. Re-register for granted origins.
  siteAccess
    .restoreGrantedSites()
    .then((count: number) => logger.info("restored granted sites", { count }))
    .catch(() => logger.warn("could not restore granted sites"));

  onMessage("runFill", async ({ data }) => {
    const memoryStore = await getLocalDataStore();
    const tab = await browser.tabs.get(data.tabId);
    if (!tab.url) {
      return { granted: false, proposals: [] };
    }

    const granted = await siteAccess.hasSiteAccess(tab.url);
    if (!granted) return { granted: false, proposals: [] };

    const { forms } = await sendMessage(
      "extractFullForm",
      undefined,
      data.tabId,
    );
    const fields = forms.flatMap((form) => form.fields);
    const origin = new URL(tab.url).origin;

    const { proposals, decisions } = await planFill(
      fields,
      ontology,
      memoryStore,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      () => crypto.randomUUID(),
      () => new Date().toISOString(),
    );

    const memoryValues = (
      await memoryStore.search({
        profileId: DEFAULT_PROFILE_ID,
      })
    )
      .map((item) => item.value)
      .filter((value): value is string => typeof value === "string");

    for (const field of fields) {
      const match = resolve(field, ontology);
      if (
        match.certainty !== Certainty.UNKNOWN &&
        match.certainty !== Certainty.AMBIGUOUS
      ) {
        continue;
      }
      await memoryStore.recordUnresolvedField(
        {
          origin,
          fieldKey: field.id,
          label: field.label ?? field.name ?? field.placeholder ?? field.id,
          kind: field.kind,
          autocomplete: field.autocomplete,
          tiersTried: match.candidates.map((candidate) => candidate.tier),
          certainty: match.certainty,
          now: new Date().toISOString(),
        },
        memoryValues,
      );
    }

    for (const [decisionId, decision] of decisions) {
      pendingDecisions.set(decisionId, decision);
    }

    return { granted: true, proposals };
  });

  onMessage("confirmFill", async ({ data }) => {
    const memoryStore = await getLocalDataStore();
    const files = createBrowserFileComplianceAdapter(await getFileStore());
    const tabId = data.tabId;

    const results = await Promise.all(
      data.decisionIds.map(async (decisionId) => {
        const decision = pendingDecisions.get(decisionId);
        if (!decision) return { decisionId, ok: false };

        const outcome = confirmDecision(decision, defaultPolicy);
        if (!outcome.ok) return { decisionId, ok: false };

        let ok = false;
        if (outcome.payload.kind === "file") {
          const prepared = await files.prepareLocalFile(
            outcome.payload.ref,
            decision.constraints ?? [],
          );
          if (prepared) {
            const result = await sendMessage(
              "uploadFile",
              {
                decisionId,
                fieldId: outcome.fieldId,
                uploadId: await stageUpload(prepared),
              },
              tabId,
            );
            ok = result.ok;
          }
        } else {
          const result = await sendMessage(
            "fillField",
            {
              decisionId,
              fieldId: outcome.fieldId,
              value: outcome.payload.value,
            },
            tabId,
          );
          ok = result.ok;
        }

        if (ok) {
          const concept = ontology.byKey(decision.conceptKey);
          const confirmedAt = new Date().toISOString();
          const horizon = concept
            ? deriveFreshnessHorizon(
                concept,
                outcome.payload.kind === "text" ? outcome.payload.value : "",
                confirmedAt,
                bundledFreshnessDurationPolicy,
              )
            : undefined;
          await recordAnswer(memoryStore, {
            profileId: DEFAULT_PROFILE_ID,
            key: decision.conceptKey,
            value:
              outcome.payload.kind === "text"
                ? outcome.payload.value
                : outcome.payload.ref,
            source: MemorySource.USER_CONFIRMED,
            now: confirmedAt,
            expiresAt: horizon?.expiresAt,
            freshnessRule: horizon?.freshnessRule,
          });
        }

        // Consumed either way: a decisionId is single-use, so it cannot be
        // replayed against a later, different page state.
        pendingDecisions.delete(decisionId);
        return { decisionId, ok };
      }),
    );

    return { results };
  });

  onMessage("recordOnboardingAnswer", async ({ data }) => {
    const memoryStore = await getLocalDataStore();
    const concept = ontology.byKey(data.key);
    const savedAt = new Date().toISOString();
    const horizon = concept
      ? deriveFreshnessHorizon(
          concept,
          data.value,
          savedAt,
          bundledFreshnessDurationPolicy,
        )
      : undefined;
    await recordAnswer(memoryStore, {
      profileId: DEFAULT_PROFILE_ID,
      key: data.key,
      value: data.value,
      label: data.label,
      source: MemorySource.USER_PROVIDED,
      now: savedAt,
      expiresAt: horizon?.expiresAt,
      freshnessRule: horizon?.freshnessRule,
    });
    return { ok: true };
  });

  onMessage("getMemorySnapshot", async () => ({
    items: await (await getLocalDataStore()).search({
      profileId: DEFAULT_PROFILE_ID,
    }),
  }));

  onMessage("exportLocalData", async () => ({
    data: await (await getLocalDataStore()).exportLocalData(),
  }));

  onMessage("importLocalData", async ({ data }) => {
    if (!isLocalDataExport(data.payload)) return { ok: false };
    await (await getLocalDataStore()).importLocalData(data.payload);
    return { ok: true };
  });

  onMessage("wipeLocalData", async () => {
    await (await getLocalDataStore()).wipeLocalData();
    pendingDecisions.clear();
    return { ok: true };
  });

  // --- Phase 2: the agent loop, alongside the straight-line flow above ---

  onMessage("startRun", async ({ data }) => {
    const tab = await browser.tabs.get(data.tabId);
    if (!tab.url) return { started: false, view: null };

    const granted = await siteAccess.hasSiteAccess(tab.url);
    if (!granted) return { started: false, view: null };

    const ports = await buildLoopPorts(data.tabId);
    const existing = await loadRunSnapshot(data.tabId);
    const snapshot =
      existing ?? createRun(ports, new URL(tab.url).origin, data.tabId);

    const next = await driveAndPersist(snapshot, ports);
    return { started: true, view: toRunView(next) };
  });

  onMessage("getRunState", async ({ data }) => {
    const snapshot = await loadRunSnapshot(data.tabId);
    return { view: snapshot ? toRunView(snapshot) : null };
  });

  onMessage("answerRunQuestion", async ({ data }) => {
    const snapshot = await loadRunSnapshot(data.tabId);
    if (!snapshot) return { ok: false, view: null };

    const ports = await buildLoopPorts(data.tabId);
    const answered = await answerQuestion(snapshot, ports, data.value);
    const next = await driveAndPersist(answered, ports);
    return { ok: true, view: toRunView(next) };
  });

  onMessage("confirmRunReview", async ({ data }) => {
    const snapshot = await loadRunSnapshot(data.tabId);
    if (!snapshot) return { ok: false, view: null };

    const ports = await buildLoopPorts(data.tabId);
    const reviewed = confirmReview(snapshot, ports, data.approve);
    const next = await driveAndPersist(reviewed, ports);
    return { ok: true, view: toRunView(next) };
  });
};

export default defineBackground(main);
