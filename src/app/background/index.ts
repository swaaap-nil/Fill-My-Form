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
import { PendingDecisionRegistry } from "~/core/fill/pending-decisions";
import { FieldKind } from "~/core/form/types";
import { createLogger, LogErrorCode } from "~/core/logging";
import { resolve } from "~/core/matching/resolve";
import { deriveFreshnessHorizon } from "~/core/memory/freshness";
import { bundledFreshnessDurationPolicy } from "~/core/memory/freshness-policy";
import type { MemoryStore } from "~/core/memory/store";
import {
  DEFAULT_PROFILE_ID,
  isFileReference,
  MemorySource,
  type MemoryValue,
} from "~/core/memory/types";
import { recordAnswer } from "~/core/memory/write-service";
import { ontology } from "~/core/ontology";
import { defaultPolicy } from "~/core/policy/default";
import { ActionRisk } from "~/core/policy/types";
import { createToolRegistry } from "~/core/tools/registry";
import { CapabilityDomain } from "~/core/tools/types";
import type { Verifier } from "~/core/verification/types";
import {
  clearAllRunSnapshots,
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
import {
  type SidePanelBrowser,
  wireToolbarIconBehavior,
} from "~/lib/toolbar-icon";

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
  fileStore ??= createIndexedDbFileReferenceStore().then(async (store) => {
    await store.purgeExpired();
    return store;
  });
  return fileStore;
};

const collectFileReferenceIds = (
  value: MemoryValue | undefined,
  ids = new Set<string>(),
): Set<string> => {
  if (isFileReference(value)) {
    ids.add(value.id);
    return ids;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return ids;
  for (const nested of Object.values(value))
    collectFileReferenceIds(nested, ids);
  return ids;
};

const deleteFileReferences = async (ids: Iterable<string>): Promise<void> => {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const store = await getFileStore();
  await Promise.all(unique.map((id) => store.delete(id)));
};

const deletedFileReferenceIds = (
  previous: MemoryValue | undefined,
  next?: MemoryValue,
): string[] => {
  const nextIds = collectFileReferenceIds(next);
  return [...collectFileReferenceIds(previous)].filter(
    (id) => !nextIds.has(id),
  );
};

const withFileReferenceCleanup = <T extends MemoryStore>(store: T): T =>
  ({
    ...store,
    async set(item) {
      const existing = await store.get(item.profileId, item.key);
      await store.set(item);
      await deleteFileReferences(
        deletedFileReferenceIds(existing?.value, item.value),
      );
    },
    async update(profileId, key, value) {
      const existing = await store.get(profileId, key);
      await store.update(profileId, key, value);
      await deleteFileReferences(
        deletedFileReferenceIds(existing?.value, value),
      );
    },
    async delete(profileId, key) {
      const existing = await store.get(profileId, key);
      await store.delete(profileId, key);
      await deleteFileReferences(deletedFileReferenceIds(existing?.value));
    },
  }) as T;

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
 * decisionId -> what `planFill` decided about one field, scoped to the tab
 * whose DOM was extracted. Cleared per id once acted on, and pruned by age,
 * so a decisionId cannot be replayed against a later tab or page state.
 * Lives only as long as the service worker does — a run that outlives a
 * worker restart is Phase 2's problem, not this straight-line driver's.
 */
const pendingDecisions = new PendingDecisionRegistry();

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
  const memoryStore = withFileReferenceCleanup(await getLocalDataStore());
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
      try {
        return await sendMessage(
          "uploadFile",
          {
            decisionId: crypto.randomUUID(),
            fieldId: input.fieldId,
            uploadId: await stageUpload(prepared),
          },
          tabId,
        );
      } finally {
        if (prepared.temporaryRef) {
          await files.cleanupPreparedFile(prepared.temporaryRef);
        }
      }
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
    userMemory: memoryStore,
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
  pendingInput: pendingInputFor(snapshot),
  review: currentReview(snapshot),
});

const pendingInputFor = (
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
    .setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch(() =>
      logger.warn("could not restrict session storage to extension contexts", {
        errorCode: LogErrorCode.EXTENSION_API,
      }),
    );

  wireToolbarIconBehavior(browser as unknown as SidePanelBrowser, logger);

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
      return { granted: false, proposals: [], uploadIntents: [] };
    }

    const granted = await siteAccess.hasSiteAccess(tab.url);
    if (!granted) return { granted: false, proposals: [], uploadIntents: [] };

    const { forms } = await sendMessage(
      "extractFullForm",
      undefined,
      data.tabId,
    );
    const fields = forms.flatMap((form) => form.fields);
    const uploadIntents = forms.flatMap((form) => form.uploadIntents ?? []);
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
      pendingDecisions.remember(decisionId, data.tabId, decision);
    }

    return { granted: true, proposals, uploadIntents };
  });

  onMessage("confirmFill", async ({ data }) => {
    const memoryStore = withFileReferenceCleanup(await getLocalDataStore());
    const files = createBrowserFileComplianceAdapter(await getFileStore());
    const tabId = data.tabId;

    const results = await Promise.all(
      data.decisionIds.map(async (decisionId) => {
        const decision = pendingDecisions.take(decisionId, tabId);
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
            try {
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
            } finally {
              if (prepared.temporaryRef) {
                await files.cleanupPreparedFile(prepared.temporaryRef);
              }
            }
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
          // A select/radio field's payload carries the page's own option
          // value (an opaque code, sometimes) — never what memory should
          // remember. `memoryValue` is the canonical text for that case;
          // every other decision leaves it unset and falls back to the
          // payload, unchanged from before this existed.
          const textMemoryValue =
            outcome.memoryValue ??
            (outcome.payload.kind === "text" ? outcome.payload.value : "");
          const horizon = concept
            ? deriveFreshnessHorizon(
                concept,
                textMemoryValue,
                confirmedAt,
                bundledFreshnessDurationPolicy,
              )
            : undefined;
          await recordAnswer(memoryStore, {
            profileId: DEFAULT_PROFILE_ID,
            key: decision.conceptKey,
            value:
              outcome.payload.kind === "text"
                ? textMemoryValue
                : outcome.payload.ref,
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
      await sendMessage("showFillFeedback", { filledCount }, tabId).catch(() =>
        logger.warn("could not show fill feedback", {
          errorCode: LogErrorCode.EXTENSION_API,
        }),
      );
    }

    return { results };
  });

  onMessage("recordOnboardingAnswer", async ({ data }) => {
    const memoryStore = withFileReferenceCleanup(await getLocalDataStore());
    const concept = ontology.byKey(data.key);
    if (!concept) return { ok: false };
    const savedAt = new Date().toISOString();
    const horizon = deriveFreshnessHorizon(
      concept,
      data.value,
      savedAt,
      bundledFreshnessDurationPolicy,
    );
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

  onMessage("deleteOnboardingAnswer", async ({ data }) => {
    await withFileReferenceCleanup(await getLocalDataStore()).delete(
      DEFAULT_PROFILE_ID,
      data.key,
    );
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
    if (data.payload.memory.some((item) => !ontology.byKey(item.key))) {
      return { ok: false };
    }
    await (await getLocalDataStore()).importLocalData(data.payload);
    return { ok: true };
  });

  onMessage("wipeLocalData", async () => {
    await (await getLocalDataStore()).wipeLocalData();
    await (await getFileStore()).clear();
    await clearAllRunSnapshots();
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
