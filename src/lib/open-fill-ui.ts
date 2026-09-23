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
    open(opts: { windowId?: number; tabId?: number }): Promise<void>;
  };
  readonly sidebarAction?: { open(): Promise<void> };
  readonly action?: {
    setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
  };
}

/**
 * Focuses the tab, records it as the fill target, and opens the fill surface.
 * `pendingFillTabId` lets the side panel auto-run fill for that tab (notification
 * / banner deep link). `windowId` is optional because `sidePanel.open` accepts
 * a `tabId` alone, which lets callers skip an async lookup that would eat the
 * user-gesture window without a manual scan click. Firefox may still reject
 * `sidebarAction.open()` without a gesture — badge remains as fallback.
 */
export const focusTabAndOpenFillUi = async (
  browserApi: OpenFillUiBrowser,
  tabId: number,
  windowId?: number,
): Promise<{ opened: boolean }> => {
  // Chrome only lets `sidePanel.open()` run inside the user gesture that
  // triggered this call, and awaiting anything first (tab update, storage
  // write) can outlive it. So start opening before any other async work; the
  // tab and pending-tab writes run alongside it.
  if (browserApi.sidePanel) {
    const opening = browserApi.sidePanel.open(
      windowId === undefined ? { tabId } : { windowId, tabId },
    );
    await Promise.all([
      opening,
      browserApi.tabs.update(tabId, { active: true }),
      setPendingFillTabId(tabId),
    ]);
    return { opened: true };
  }

  if (browserApi.sidebarAction) {
    // Same gesture rule as above: `sidebarAction.open()` first, other work after.
    const opening = browserApi.sidebarAction.open().then(
      () => true,
      () => false,
    );
    await Promise.all([
      browserApi.tabs.update(tabId, { active: true }),
      setPendingFillTabId(tabId),
    ]);
    if (await opening) return { opened: true };
    await browserApi.action?.setBadgeText({ text: "1" });
    return { opened: false };
  }

  await browserApi.tabs.update(tabId, { active: true });
  await setPendingFillTabId(tabId);
  return { opened: false };
};
