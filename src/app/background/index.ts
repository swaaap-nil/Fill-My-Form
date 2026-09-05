import { browser } from "wxt/browser";
import { defineBackground } from "#imports";
import { confirmDecision, planFill } from "~/core/fill/driver";
import type { DecisionId, PendingDecision } from "~/core/fill/types";
import { createLogger } from "~/core/logging";
import { createInMemoryMemoryStore } from "~/core/memory/in-memory";
import { DEFAULT_PROFILE_ID, MemorySource } from "~/core/memory/types";
import { recordAnswer } from "~/core/memory/write-service";
import { ontology } from "~/core/ontology";
import { defaultPolicy } from "~/core/policy/default";
import { onMessage, sendMessage } from "~/lib/messaging";
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

const getActiveTab = async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
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

  onMessage("runFill", async () => {
    const tab = await getActiveTab();
    if (!tab?.url || tab.id === undefined) {
      return { granted: false, proposals: [] };
    }

    const granted = await siteAccess.hasSiteAccess(tab.url);
    if (!granted) return { granted: false, proposals: [] };

    const { forms } = await sendMessage("extractFullForm", undefined, tab.id);
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
    const tab = await getActiveTab();
    if (tab?.id === undefined) {
      return {
        results: data.decisionIds.map((decisionId) => ({
          decisionId,
          ok: false,
        })),
      };
    }
    const tabId = tab.id;

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
};

export default defineBackground(main);
