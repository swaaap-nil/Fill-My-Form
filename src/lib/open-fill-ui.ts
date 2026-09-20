import type { Browser } from "wxt/browser";
import { setPendingFillTabId } from "~/lib/pending-fill-tab";

export interface OpenFillUiBrowser {
  readonly tabs: {
    update(
      tabId: number,
      props: { active: boolean },
    ): Promise<Browser.tabs.Tab>;
  };
  readonly sidePanel?: {
    open(opts: { windowId: number; tabId?: number }): Promise<void>;
  };
  readonly sidebarAction?: { open(): Promise<void> };
  readonly action?: {
    setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
  };
}

/**
 * Focuses the tab, records it as the fill target, and opens the fill surface.
 * `pendingFillTabId` lets the side panel auto-run fill for that tab (notification
 * / banner deep link) without a manual scan click. Firefox may still reject
 * `sidebarAction.open()` without a gesture — badge remains as fallback.
 */
export const focusTabAndOpenFillUi = async (
  browserApi: OpenFillUiBrowser,
  tabId: number,
  windowId: number,
): Promise<{ opened: boolean }> => {
  await browserApi.tabs.update(tabId, { active: true });
  await setPendingFillTabId(tabId);

  if (browserApi.sidePanel) {
    await browserApi.sidePanel.open({ windowId, tabId });
    return { opened: true };
  }

  if (browserApi.sidebarAction) {
    try {
      await browserApi.sidebarAction.open();
      return { opened: true };
    } catch {
      await browserApi.action?.setBadgeText({ text: "1" });
      return { opened: false };
    }
  }

  return { opened: false };
};
