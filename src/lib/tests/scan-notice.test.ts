import { describe, expect, it } from "bun:test";
import { deriveScanNotice, type ScanNoticeInput } from "~/lib/scan-notice";

const base: ScanNoticeInput = {
  scanState: "idle",
  scanUiState: "idle",
  hintKind: undefined,
  accessChecked: true,
  activeTabGranted: false,
  activeTabUrl: "https://example.com/apply",
};

const derive = (overrides: Partial<ScanNoticeInput> = {}) =>
  deriveScanNotice({ ...base, ...overrides });

describe("deriveScanNotice", () => {
  it("asks for access up front on an ungranted http(s) page", () => {
    expect(derive()).toEqual({ kind: "needs_access", showRefreshTip: true });
  });

  it("stays silent until the first permission check resolves", () => {
    expect(derive({ accessChecked: false })).toEqual({
      kind: "none",
      showRefreshTip: false,
    });
  });

  it("stays silent once access is granted", () => {
    expect(derive({ activeTabGranted: true }).kind).toBe("none");
  });

  it("stays silent on non-http(s) pages", () => {
    expect(derive({ activeTabUrl: "chrome://extensions" }).kind).toBe("none");
    expect(derive({ activeTabUrl: undefined }).kind).toBe("none");
  });

  it("stays silent while a scan is running or has results", () => {
    expect(derive({ scanUiState: "scanning" }).kind).toBe("none");
    expect(
      derive({ scanState: "proposals", scanUiState: "results" }).kind,
    ).toBe("none");
  });

  it("shows the needs-access notice and chip after a failed access request", () => {
    expect(derive({ scanState: "not_granted", hintKind: "message" })).toEqual({
      kind: "needs_access",
      showRefreshTip: true,
    });
  });

  it("shows the unreadable notice without the chip when access is held", () => {
    expect(
      derive({
        scanState: "not_granted",
        hintKind: "unreadable_page",
        activeTabGranted: true,
      }),
    ).toEqual({ kind: "unreadable_page", showRefreshTip: false });
  });

  it("shows the internal-page notice without the chip", () => {
    expect(
      derive({ scanState: "not_granted", hintKind: "internal_page" }),
    ).toEqual({ kind: "internal_page", showRefreshTip: false });
  });
});
