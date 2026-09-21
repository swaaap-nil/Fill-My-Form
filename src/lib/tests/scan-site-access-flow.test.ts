import { describe, expect, it } from "bun:test";
import {
  runAllSitesAccessRequest,
  runScanSiteAccess,
  shouldAutoScanGrantedTab,
} from "~/lib/scan-site-access-flow";
import { createSiteAccess } from "~/lib/site-access";
import {
  createChromeFakeBrowser,
  createFirefoxFakeBrowser,
  GESTURE_BROWSERS,
  GESTURE_ERROR,
} from "./fake-site-access-browser";

describe("runScanSiteAccess", () => {
  it("returns no_tab when the panel has no cached tab", async () => {
    await expect(
      runScanSiteAccess({
        requestSiteAccess: async () => true,
      }),
    ).resolves.toEqual({ kind: "no_tab" });
  });

  it("does not call request for chrome:// or other non-http(s) URLs", async () => {
    let called = false;
    await expect(
      runScanSiteAccess({
        url: "chrome://extensions",
        tabId: 1,
        requestSiteAccess: async () => {
          called = true;
          return true;
        },
      }),
    ).resolves.toEqual({ kind: "not_permissible" });
    expect(called).toBe(false);
  });

  it("maps a user decline to denied", async () => {
    await expect(
      runScanSiteAccess({
        url: "https://example.com/form",
        tabId: 1,
        requestSiteAccess: async () => false,
      }),
    ).resolves.toEqual({ kind: "denied" });
  });

  it("maps a gesture throw to request_threw", async () => {
    await expect(
      runScanSiteAccess({
        url: "https://example.com/form",
        tabId: 1,
        requestSiteAccess: async () => {
          throw new Error(GESTURE_ERROR);
        },
      }),
    ).resolves.toEqual({ kind: "request_threw" });
  });

  for (const [browserName, createBrowser] of GESTURE_BROWSERS) {
    it(`calls request() first and grants on ${browserName}`, async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);

      const outcome = await runScanSiteAccess({
        url: "https://example.com/form",
        tabId: 4,
        requestSiteAccess: (url, tabId) =>
          siteAccess.requestSiteAccess(url, tabId),
      });

      expect(outcome).toEqual({ kind: "granted" });
      expect(fake.promptedOrigins).toEqual([["https://example.com/*"]]);
    });

    it(`does not re-prompt an already-granted origin on ${browserName}`, async () => {
      const fake = createBrowser({
        grantedOrigins: new Set(["https://example.com/*"]),
      });
      const siteAccess = createSiteAccess(fake);

      const outcome = await runScanSiteAccess({
        url: "https://example.com/form",
        tabId: 4,
        requestSiteAccess: (url, tabId) =>
          siteAccess.requestSiteAccess(url, tabId),
      });

      expect(outcome).toEqual({ kind: "granted" });
      expect(fake.promptedOrigins).toEqual([]);
    });

    it(`treats a post-grant register throw as granted on ${browserName}`, async () => {
      const fake = createBrowser();
      fake.registerShouldThrow = () => true;
      const siteAccess = createSiteAccess(fake);

      const outcome = await runScanSiteAccess({
        url: "https://example.com/form",
        tabId: 4,
        requestSiteAccess: (url, tabId) =>
          siteAccess.requestSiteAccess(url, tabId),
      });

      expect(outcome).toEqual({ kind: "granted" });
      expect(fake.grantedOrigins.has("https://example.com/*")).toBe(true);
    });
  }
});

describe("contains-then-request vs request-first", () => {
  it("Firefox: contains then request loses the gesture", async () => {
    const fake = createFirefoxFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    await siteAccess.hasSiteAccess("https://example.com/form");
    const outcome = await runScanSiteAccess({
      url: "https://example.com/form",
      tabId: 1,
      requestSiteAccess: (url, tabId) =>
        siteAccess.requestSiteAccess(url, tabId),
    });

    expect(outcome).toEqual({ kind: "request_threw" });
  });

  it("Chrome: contains then request still grants", async () => {
    const fake = createChromeFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    await siteAccess.hasSiteAccess("https://example.com/form");
    const outcome = await runScanSiteAccess({
      url: "https://example.com/form",
      tabId: 1,
      requestSiteAccess: (url, tabId) =>
        siteAccess.requestSiteAccess(url, tabId),
    });

    expect(outcome).toEqual({ kind: "granted" });
  });

  it("Firefox: request first (the Scan path) grants", async () => {
    const fake = createFirefoxFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    const outcome = await runScanSiteAccess({
      url: "https://example.com/form",
      tabId: 1,
      requestSiteAccess: (url, tabId) =>
        siteAccess.requestSiteAccess(url, tabId),
    });

    expect(outcome).toEqual({ kind: "granted" });
  });
});

describe("runAllSitesAccessRequest", () => {
  it("completes when the grant succeeds", async () => {
    await expect(
      runAllSitesAccessRequest({
        requestAllSiteAccess: async () => true,
        tabId: 1,
      }),
    ).resolves.toEqual({ kind: "completed", granted: true });
  });

  it("completes with granted false when the user declines", async () => {
    await expect(
      runAllSitesAccessRequest({
        requestAllSiteAccess: async () => false,
      }),
    ).resolves.toEqual({ kind: "completed", granted: false });
  });

  it("reports failed when the permission API throws", async () => {
    await expect(
      runAllSitesAccessRequest({
        requestAllSiteAccess: async () => {
          throw new Error(GESTURE_ERROR);
        },
      }),
    ).resolves.toEqual({ kind: "failed", reason: "request_threw" });
  });
});

describe("shouldAutoScanGrantedTab", () => {
  it("auto-scans an http(s) tab that is already allowed and has no snapshot", () => {
    expect(
      shouldAutoScanGrantedTab({
        url: "https://example.com/form",
        hasAccess: true,
        hasSnapshot: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoScanGrantedTab({
        url: "http://localhost:4173/simple.html",
        hasAccess: true,
        hasSnapshot: false,
      }),
    ).toBe(true);
  });

  it("does not auto-scan when access is missing, a snapshot exists, or the URL is not http(s)", () => {
    expect(
      shouldAutoScanGrantedTab({
        url: "https://example.com/form",
        hasAccess: false,
        hasSnapshot: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoScanGrantedTab({
        url: "https://example.com/form",
        hasAccess: true,
        hasSnapshot: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoScanGrantedTab({
        url: "chrome://extensions",
        hasAccess: true,
        hasSnapshot: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoScanGrantedTab({
        url: "chrome-extension://abc/sidepanel.html",
        hasAccess: true,
        hasSnapshot: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoScanGrantedTab({
        hasAccess: true,
        hasSnapshot: false,
      }),
    ).toBe(false);
  });
});
