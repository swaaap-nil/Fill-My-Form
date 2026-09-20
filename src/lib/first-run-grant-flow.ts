/**
 * First-run "Continue" outcome — extracted so the gate UI and tests share one
 * interpretation of grant success vs failure.
 */
export type FirstRunGrantOutcome =
  | { readonly kind: "completed"; readonly granted: boolean }
  | { readonly kind: "failed"; readonly reason: "request_threw" };

export const runFirstRunAllSitesGrant = async (deps: {
  requestAllSiteAccess(activeTabId?: number): Promise<boolean>;
  markFirstRunSiteAccess(update: { globalDeclined: boolean }): Promise<void>;
  activeTabId?: number;
}): Promise<FirstRunGrantOutcome> => {
  let granted: boolean;
  try {
    granted = await deps.requestAllSiteAccess(deps.activeTabId);
  } catch {
    return { kind: "failed", reason: "request_threw" };
  }
  await deps.markFirstRunSiteAccess({ globalDeclined: !granted });
  return { kind: "completed", granted };
};
