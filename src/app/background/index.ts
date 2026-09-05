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
} from "~/core/agent/loop";
import { isTerminal } from "~/core/agent/types";
import { confirmDecision, planFill } from "~/core/fill/driver";
import type { DecisionId, PendingDecision } from "~/core/fill/types";
import { createLogger } from "~/core/logging";
import { createInMemoryMemoryStore } from "~/core/memory/in-memory";
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
import { inspectFormOutputSchema } from "~/lib/form/schema";
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
const memoryStore = createInMemoryMemoryStore();

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
const buildLoopPorts = (tabId: number): LoopPorts => {
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
  // Clicking the toolbar icon opens the side panel. Requires no
  // `action.default_popup` in the manifest, and Chrome only. Firefox has no
  // sidePanel API, so this is feature-detected rather than assumed.
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) =>
      logger.warn("could not set side panel behavior", {
        errorCode: String(error),
      }),
    );

  // Runtime content-script registrations do not survive a browser restart,
  // but the user's permission grants do. Re-register for granted origins.
  siteAccess
    .restoreGrantedSites()
    .then((count: number) => logger.info("restored granted sites", { count }))
    .catch(() => logger.warn("could not restore granted sites"));

  onMessage("runFill", async ({ data }) => {
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

    const { proposals, decisions } = await planFill(
      fields,
      ontology,
      memoryStore,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
    );

    for (const [decisionId, decision] of decisions) {
      pendingDecisions.set(decisionId, decision);
    }

    return { granted: true, proposals };
  });

  onMessage("confirmFill", async ({ data }) => {
    const tabId = data.tabId;

    const results = await Promise.all(
      data.decisionIds.map(async (decisionId) => {
        const decision = pendingDecisions.get(decisionId);
        if (!decision) return { decisionId, ok: false };

        const outcome = confirmDecision(decision, defaultPolicy);
        if (!outcome.ok) return { decisionId, ok: false };

        const { ok } = await sendMessage(
          "fillField",
          { decisionId, fieldId: outcome.fieldId, value: outcome.value },
          tabId,
        );

        // Consumed either way: a decisionId is single-use, so it cannot be
        // replayed against a later, different page state.
        pendingDecisions.delete(decisionId);
        return { decisionId, ok };
      }),
    );

    return { results };
  });

  onMessage("recordOnboardingAnswer", async ({ data }) => {
    await recordAnswer(memoryStore, {
      profileId: DEFAULT_PROFILE_ID,
      key: data.key,
      value: data.value,
      label: data.label,
      source: MemorySource.USER_PROVIDED,
      now: new Date().toISOString(),
    });
    return { ok: true };
  });

  onMessage("getMemorySnapshot", async () => ({
    items: await memoryStore.search({ profileId: DEFAULT_PROFILE_ID }),
  }));

  // --- Phase 2: the agent loop, alongside the straight-line flow above ---

  onMessage("startRun", async ({ data }) => {
    const tab = await browser.tabs.get(data.tabId);
    if (!tab.url) return { started: false, view: null };

    const granted = await siteAccess.hasSiteAccess(tab.url);
    if (!granted) return { started: false, view: null };

    const ports = buildLoopPorts(data.tabId);
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

    const ports = buildLoopPorts(data.tabId);
    const answered = await answerQuestion(snapshot, ports, data.value);
    const next = await driveAndPersist(answered, ports);
    return { ok: true, view: toRunView(next) };
  });

  onMessage("confirmRunReview", async ({ data }) => {
    const snapshot = await loadRunSnapshot(data.tabId);
    if (!snapshot) return { ok: false, view: null };

    const ports = buildLoopPorts(data.tabId);
    const reviewed = confirmReview(snapshot, ports, data.approve);
    const next = await driveAndPersist(reviewed, ports);
    return { ok: true, view: toRunView(next) };
  });
};

export default defineBackground(main);
