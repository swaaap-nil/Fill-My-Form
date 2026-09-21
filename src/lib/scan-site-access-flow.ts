import { isPermissibleUrl } from "~/lib/site-access";

/**
 * Scan-click host access. `permissions.request` must be the first await
 * from the click: Firefox drops the user-gesture flag after `contains()`
 * or `tabs.query()`. Already-granted origins resolve true with no prompt.
 */

export type ScanSiteAccessOutcome =
  | { readonly kind: "granted" }
  | { readonly kind: "denied" }
  | { readonly kind: "not_permissible" }
  | { readonly kind: "no_tab" }
  | { readonly kind: "request_threw" };

export const runScanSiteAccess = async (deps: {
  url?: string;
  tabId?: number;
  requestSiteAccess: (url: string, tabId?: number) => Promise<boolean>;
}): Promise<ScanSiteAccessOutcome> => {
  if (deps.tabId === undefined || deps.url === undefined) {
    return { kind: "no_tab" };
  }
  if (!isPermissibleUrl(deps.url)) {
    return { kind: "not_permissible" };
  }

  try {
    const granted = await deps.requestSiteAccess(deps.url, deps.tabId);
    return granted ? { kind: "granted" } : { kind: "denied" };
  } catch {
    return { kind: "request_threw" };
  }
};

export type AllSitesAccessOutcome =
  | { readonly kind: "completed"; readonly granted: boolean }
  | { readonly kind: "failed"; readonly reason: "request_threw" };

export const runAllSitesAccessRequest = async (deps: {
  requestAllSiteAccess: (tabId?: number) => Promise<boolean>;
  tabId?: number;
}): Promise<AllSitesAccessOutcome> => {
  try {
    const granted = await deps.requestAllSiteAccess(deps.tabId);
    return { kind: "completed", granted };
  } catch {
    return { kind: "failed", reason: "request_threw" };
  }
};
