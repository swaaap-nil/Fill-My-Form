import type { Browser } from "wxt/browser";
import { browser } from "wxt/browser";

/**
 * Resolves the tab the user is browsing in while the side panel is open.
 * `currentWindow` is usually correct; `lastFocusedWindow` is a fallback when
 * the panel context does not attach to the browser window (seen in dev).
 */
export const getActiveBrowserTab = async (): Promise<
  Browser.tabs.Tab | undefined
> => {
  const inPanelWindow = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (inPanelWindow[0]?.id !== undefined) return inPanelWindow[0];

  const [focused] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  return focused;
};
