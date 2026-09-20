import { browser } from "wxt/browser";

const SESSION_KEY = "pendingFillTabId";

export const setPendingFillTabId = async (tabId: number): Promise<void> => {
  await browser.storage.session.set({ [SESSION_KEY]: tabId });
};

export const consumePendingFillTabId = async (): Promise<
  number | undefined
> => {
  const stored = await browser.storage.session.get(SESSION_KEY);
  const tabId = stored[SESSION_KEY];
  if (typeof tabId !== "number") return undefined;
  await browser.storage.session.remove(SESSION_KEY);
  return tabId;
};

export const peekPendingFillTabId = async (): Promise<number | undefined> => {
  const stored = await browser.storage.session.get(SESSION_KEY);
  const tabId = stored[SESSION_KEY];
  return typeof tabId === "number" ? tabId : undefined;
};
