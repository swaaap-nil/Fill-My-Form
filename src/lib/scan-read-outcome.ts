/**
 * What the panel should believe after a scan of a permission-granted tab
 * could not read the page.
 *
 * "Permission held" and "page readable" are separate facts. Some pages
 * (browser stores, PDF viewers, error pages) keep a granted permission but
 * refuse script injection; treating that as revoked access hides the access
 * line even though nothing about the grant changed.
 */

export type ScanReadFailureHint = "unreadable_page" | "needs_access";

export interface ScanReadFailureState {
  readonly activeTabGranted: boolean;
  readonly hint: ScanReadFailureHint;
}

export const classifyScanReadFailure = (input: {
  readonly permissionHeld: boolean;
  readonly injectionRefused: boolean;
}): ScanReadFailureState =>
  input.permissionHeld
    ? { activeTabGranted: true, hint: "unreadable_page" }
    : { activeTabGranted: false, hint: "needs_access" };
