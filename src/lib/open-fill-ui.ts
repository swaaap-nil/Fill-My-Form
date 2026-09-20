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
 * Focuses the tab and opens the fill surface. Firefox may reject
 * `sidebarAction.open()` without a gesture after awaits — callers should
 * set pending tab + badge when open fails.
 */
export const focusTabAndOpenFillUi = async (
  browserApi: OpenFillUiBrowser,
  tabId: number,
  windowId: number,
): Promise<{ opened: boolean }> => {
  await browserApi.tabs.update(tabId, { active: true });

  if (browserApi.sidePanel) {
    await browserApi.sidePanel.open({ windowId, tabId });
    return { opened: true };
  }

  if (browserApi.sidebarAction) {
    try {
      await browserApi.sidebarAction.open();
      return { opened: true };
    } catch {
      await setPendingFillTabId(tabId);
      await browserApi.action?.setBadgeText({ text: "1" });
      return { opened: false };
    }
  }

  await setPendingFillTabId(tabId);
  return { opened: false };
};
