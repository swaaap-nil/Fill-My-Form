import { browser } from "wxt/browser";
import { siteAccess } from "~/lib/site-access";

const STORAGE_KEY = "firstRunSiteAccess";

export interface FirstRunSiteAccessRecord {
  readonly promptSeen: boolean;
  readonly globalDeclined: boolean;
}

const defaultRecord = (): FirstRunSiteAccessRecord => ({
  promptSeen: false,
  globalDeclined: false,
});

export const loadFirstRunSiteAccess =
  async (): Promise<FirstRunSiteAccessRecord> => {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY];
    if (
      value &&
      typeof value === "object" &&
      "promptSeen" in value &&
      typeof (value as FirstRunSiteAccessRecord).promptSeen === "boolean"
    ) {
      return value as FirstRunSiteAccessRecord;
    }
    return defaultRecord();
  };

export const markFirstRunSiteAccess = async (
  update: Partial<FirstRunSiteAccessRecord>,
): Promise<void> => {
  const current = await loadFirstRunSiteAccess();
  await browser.storage.local.set({
    [STORAGE_KEY]: { ...current, ...update, promptSeen: true },
  });
};

/** Show the all-sites gate until the user chooses or already has global access. */
export const isFirstRunAccessGatePending = (
  hasAllSiteAccess: boolean,
  promptSeen: boolean,
): boolean => !hasAllSiteAccess && !promptSeen;

export const shouldShowFirstRunAccessGate = async (): Promise<boolean> => {
  const hasAllSiteAccess = await siteAccess.hasAllSiteAccess();
  if (hasAllSiteAccess) return false;
  const record = await loadFirstRunSiteAccess();
  return isFirstRunAccessGatePending(hasAllSiteAccess, record.promptSeen);
};
