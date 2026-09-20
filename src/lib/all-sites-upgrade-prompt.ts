import { browser } from "wxt/browser";

const STORAGE_KEY = "allSitesUpgradePrompt";
export const ALL_SITES_UPGRADE_SNOOZE_DAYS = 7;
export const ALL_SITES_UPGRADE_FULL_STRIP_MAX_IMPRESSIONS = 3;

export interface AllSitesUpgradeState {
  readonly snoozedUntilIso: string | null;
  readonly impressionCount: number;
}

const defaultState = (): AllSitesUpgradeState => ({
  snoozedUntilIso: null,
  impressionCount: 0,
});

export const loadAllSitesUpgradeState =
  async (): Promise<AllSitesUpgradeState> => {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY];
    if (
      value &&
      typeof value === "object" &&
      "impressionCount" in value &&
      typeof (value as AllSitesUpgradeState).impressionCount === "number"
    ) {
      const record = value as AllSitesUpgradeState;
      return {
        snoozedUntilIso:
          typeof record.snoozedUntilIso === "string"
            ? record.snoozedUntilIso
            : null,
        impressionCount: record.impressionCount,
      };
    }
    return defaultState();
  };

const saveAllSitesUpgradeState = async (
  state: AllSitesUpgradeState,
): Promise<void> => {
  await browser.storage.local.set({ [STORAGE_KEY]: state });
};

export const isAllSitesUpgradeSnoozed = (
  state: AllSitesUpgradeState,
  nowIso: string,
): boolean => {
  if (!state.snoozedUntilIso) return false;
  return state.snoozedUntilIso > nowIso;
};

export const shouldShowAllSitesUpgradeStrip = (
  state: AllSitesUpgradeState,
  nowIso: string,
  hasAllSiteAccess: boolean,
  hasSuccessfulScan: boolean,
): boolean => {
  if (hasAllSiteAccess || !hasSuccessfulScan) return false;
  if (isAllSitesUpgradeSnoozed(state, nowIso)) return false;
  return state.impressionCount < ALL_SITES_UPGRADE_FULL_STRIP_MAX_IMPRESSIONS;
};

export const shouldShowAllSitesUpgradeLink = (
  state: AllSitesUpgradeState,
  nowIso: string,
  hasAllSiteAccess: boolean,
  hasSuccessfulScan: boolean,
): boolean => {
  if (hasAllSiteAccess || !hasSuccessfulScan) return false;
  if (isAllSitesUpgradeSnoozed(state, nowIso)) return false;
  return state.impressionCount >= ALL_SITES_UPGRADE_FULL_STRIP_MAX_IMPRESSIONS;
};

export const recordUpgradeImpression = (
  state: AllSitesUpgradeState,
): AllSitesUpgradeState => ({
  ...state,
  impressionCount: state.impressionCount + 1,
});

export const persistUpgradeImpression =
  async (): Promise<AllSitesUpgradeState> => {
    const current = await loadAllSitesUpgradeState();
    const next = recordUpgradeImpression(current);
    await saveAllSitesUpgradeState(next);
    return next;
  };

export const snoozeAllSitesUpgrade = async (
  days = ALL_SITES_UPGRADE_SNOOZE_DAYS,
): Promise<AllSitesUpgradeState> => {
  const current = await loadAllSitesUpgradeState();
  const until = new Date();
  until.setDate(until.getDate() + days);
  const next: AllSitesUpgradeState = {
    ...current,
    snoozedUntilIso: until.toISOString(),
  };
  await saveAllSitesUpgradeState(next);
  return next;
};

export const clearAllSitesUpgradeSnooze = async (): Promise<void> => {
  const current = await loadAllSitesUpgradeState();
  await saveAllSitesUpgradeState({ ...current, snoozedUntilIso: null });
};
