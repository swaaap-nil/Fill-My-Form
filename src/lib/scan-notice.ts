import { isPermissibleUrl } from "~/lib/site-access";

/**
 * Which full-panel notice (if any) the side panel shows in place of scan
 * results, and whether the "refresh the page" chip shows beside the Scan
 * button. Pure so the rules are testable without rendering the panel.
 */

export type ScanNoticeKind =
  | "none"
  | "needs_access"
  | "internal_page"
  | "unreadable_page";

export interface ScanNoticeInput {
  readonly scanState: "idle" | "not_granted" | "proposals";
  readonly scanUiState: string;
  readonly hintKind:
    | "internal_page"
    | "unreadable_page"
    | "message"
    | undefined;
  /** False until the first permission check for the active tab resolves. */
  readonly accessChecked: boolean;
  readonly activeTabGranted: boolean;
  readonly activeTabUrl: string | undefined;
}

export interface ScanNotice {
  readonly kind: ScanNoticeKind;
  readonly showRefreshTip: boolean;
}

export const deriveScanNotice = (input: ScanNoticeInput): ScanNotice => {
  if (input.scanState === "not_granted") {
    if (input.hintKind === "internal_page") {
      return { kind: "internal_page", showRefreshTip: false };
    }
    if (input.hintKind === "unreadable_page") {
      return { kind: "unreadable_page", showRefreshTip: false };
    }
    return { kind: "needs_access", showRefreshTip: true };
  }

  const needsAccessUpFront =
    input.scanState === "idle" &&
    input.scanUiState === "idle" &&
    input.accessChecked &&
    !input.activeTabGranted &&
    input.activeTabUrl !== undefined &&
    isPermissibleUrl(input.activeTabUrl);

  return needsAccessUpFront
    ? { kind: "needs_access", showRefreshTip: true }
    : { kind: "none", showRefreshTip: false };
};
