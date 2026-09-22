import { browser as extensionBrowser } from "wxt/browser";
import { planFill } from "~/core/fill/driver";
import type { PendingDecision } from "~/core/fill/types";
import type { Form } from "~/core/form/types";
import { DEFAULT_PROFILE_ID } from "~/core/memory/types";
import { ontology } from "~/core/ontology";
import { defaultPolicy } from "~/core/policy/default";
import { deliverDetectionNudges } from "~/lib/deliver-detection-nudges";
import { clearDetectionBadge, setDetectionBadge } from "~/lib/detection-nudge";
import type { PersistentLocalDataStore } from "~/lib/indexeddb-local-data";
import { onMessage, sendMessage } from "~/lib/messaging";
import { focusTabAndOpenFillUi } from "~/lib/open-fill-ui";
import {
  countActionableProposals,
  type DetectionDedupeState,
  shouldNotifyForDetection,
} from "~/lib/proactive-detection";
import { siteAccess } from "~/lib/site-access";
import {
  buildDetectionTabFillSnapshot,
  saveTabFillSnapshot,
} from "~/lib/tab-fill-snapshot";

const detectionDedupeByTab = new Map<number, DetectionDedupeState>();

const hasAnyMemory = async (
  memoryStore: PersistentLocalDataStore,
): Promise<boolean> => {
  const items = await memoryStore.search({ profileId: DEFAULT_PROFILE_ID });
  return items.length > 0;
};

export const wireProactiveDetection = (deps: {
  readonly getLocalDataStore: () => Promise<PersistentLocalDataStore>;
  readonly iconUrl: string;
}): void => {
  const browser = extensionBrowser;
  const { getLocalDataStore, iconUrl } = deps;

  onMessage("getPageAccessForUrl", async ({ data }) => ({
    mayDetect: await siteAccess.hasSiteAccess(data.url),
  }));

  onMessage("formPageDetected", async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return { ack: false };

    const tab = await browser.tabs.get(tabId);
    if (!tab.url || !(await siteAccess.hasSiteAccess(tab.url))) {
      return { ack: false };
    }

    const memoryStore = await getLocalDataStore();
    if (!(await hasAnyMemory(memoryStore))) {
      return { ack: true };
    }

    let extracted: { forms: readonly Form[] };
    try {
      extracted = await sendMessage("extractFullForm", undefined, tabId);
    } catch {
      return { ack: false };
    }

    const fields = extracted.forms.flatMap((form) => form.fields);
    const uploadIntents = extracted.forms.flatMap(
      (form) => form.uploadIntents ?? [],
    );
    const documentLocale = extracted.forms[0]?.documentLocale;
    const { proposals, decisions } = await planFill(
      fields,
      ontology,
      memoryStore,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      () => crypto.randomUUID(),
      () => new Date().toISOString(),
      documentLocale,
    );

    for (const [decisionId, decision] of decisions) {
      // Remember decisions so notification → panel → confirm works without rescan.
      pendingDecisionsProxy.remember(decisionId, tabId, decision);
    }

    const counts = countActionableProposals(proposals);
    const nowMs = Date.now();

    if (counts.knownFieldCount > 0) {
      await saveTabFillSnapshot(
        buildDetectionTabFillSnapshot({
          tabId,
          pageUrl: data.url,
          proposals,
          uploadIntents,
          savedAtMs: nowMs,
        }),
      );
    }

    const previous = detectionDedupeByTab.get(tabId);
    if (
      !shouldNotifyForDetection(previous, { url: data.url, ...counts }, nowMs)
    ) {
      return { ack: true };
    }

    detectionDedupeByTab.set(tabId, {
      url: data.url,
      knownFieldCount: counts.knownFieldCount,
      answerCount: counts.answerCount,
      notifiedAtMs: nowMs,
    });

    await deliverDetectionNudges(
      {
        tabId,
        knownFieldCount: counts.knownFieldCount,
        answerCount: counts.answerCount,
        generation: data.generation,
        iconUrl,
      },
      {
        getTitle: () => browser.i18n.getMessage("proactiveDetectionTitle"),
        getBody: (knownFieldCount, answerCount) =>
          browser.i18n.getMessage("proactiveDetectionBody", [
            String(knownFieldCount),
            String(answerCount),
          ]),
        createNotification: async (notificationId, options) => {
          await browser.notifications.create(notificationId, options);
        },
        setBadge: (id) => setDetectionBadge(browser, id),
        showFormDetectionNudge: async (id, payload) => {
          await sendMessage("showFormDetectionNudge", payload, id);
        },
        ackFormPageDetected: async (id, generation) => {
          await sendMessage("ackFormPageDetected", { generation }, id);
        },
      },
    );

    return { ack: true };
  });

  browser.notifications.onClicked.addListener((notificationId: string) => {
    const prefix = "form-detection-";
    if (!notificationId.startsWith(prefix)) return;
    const tabId = Number.parseInt(notificationId.slice(prefix.length), 10);
    if (Number.isNaN(tabId)) return;

    void (async () => {
      const tab = await browser.tabs.get(tabId);
      if (tab.windowId === undefined) return;
      await focusTabAndOpenFillUi(
        browser as Parameters<typeof focusTabAndOpenFillUi>[0],
        tabId,
        tab.windowId,
      );
      await clearDetectionBadge(browser, tabId);
    })();
  });

  onMessage("openFillUiFromTab", async ({ sender }) => {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    if (tabId === undefined || windowId === undefined) {
      return { opened: false };
    }

    const { opened } = await focusTabAndOpenFillUi(
      browser as Parameters<typeof focusTabAndOpenFillUi>[0],
      tabId,
      windowId,
    );
    await clearDetectionBadge(browser, tabId);
    return { opened };
  });
};

/**
 * Background holds pending decisions for confirmFill; proactive detection must
 * register the same map. Set from background index before wiring.
 */
export const pendingDecisionsProxy: {
  remember(decisionId: string, tabId: number, decision: PendingDecision): void;
} = {
  remember: () => {},
};
