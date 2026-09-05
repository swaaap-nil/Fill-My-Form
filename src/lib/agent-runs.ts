/**
 * Persists one `RunSnapshot` per tab in `chrome.storage.session`.
 *
 * This is the adapter half of Phase 2's resumability story: `RunSnapshot`
 * (`~/core/agent/loop`) is plain JSON by construction, and `session` storage
 * — unlike `local` — is cleared when the browser itself closes, which is the
 * right lifetime for data that includes in-flight field values: it survives
 * exactly a service-worker restart, not a full restart of the browser.
 *
 * Keyed by tab id rather than run id: the background always knows "the run
 * for this tab", and a tab can only ever have one run in flight at a time in
 * this phase (no concurrent runs per tab).
 */

import { browser } from "wxt/browser";
import type { RunSnapshot } from "~/core/agent/loop";

const keyFor = (tabId: number): string => `agent-run:${tabId}`;

export const saveRunSnapshot = async (snapshot: RunSnapshot): Promise<void> => {
  await browser.storage.session.set({ [keyFor(snapshot.tabId)]: snapshot });
};

export const loadRunSnapshot = async (
  tabId: number,
): Promise<RunSnapshot | undefined> => {
  const stored = await browser.storage.session.get(keyFor(tabId));
  return stored[keyFor(tabId)] as RunSnapshot | undefined;
};

export const clearRunSnapshot = async (tabId: number): Promise<void> => {
  await browser.storage.session.remove(keyFor(tabId));
};
