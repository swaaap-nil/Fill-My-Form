import { describe, expect, it } from "bun:test";
import {
  ALL_SITE_ORIGINS,
  contentScriptIdFor,
  createSiteAccess,
  GLOBAL_HTTP_SCRIPT_ID,
  GLOBAL_HTTPS_SCRIPT_ID,
  toOriginPattern,
  wireSiteAccessPermissionEvents,
} from "~/lib/site-access";
import {
  createChromeFakeBrowser,
  createFakeBrowser,
  createFirefoxFakeBrowser,
  GESTURE_BROWSERS,
  GESTURE_ERROR,
} from "./fake-site-access-browser";

describe("toOriginPattern", () => {
  it("strips the path and query string, keeping only the origin", () => {
    expect(toOriginPattern("https://example.com/apply?token=abc123")).toBe(
      "https://example.com/*",
    );
  });

  it("preserves a non-default port", () => {
    expect(toOriginPattern("http://localhost:4173/simple.html")).toBe(
      "http://localhost:4173/*",
    );
  });
});

describe("contentScriptIdFor", () => {
  it("does not collide for hostnames that squash to the same alphanumeric id", () => {
    expect(contentScriptIdFor("https://foo.bar.com/*")).not.toBe(
      contentScriptIdFor("https://foo-bar.com/*"),
    );
  });
});

for (const [browserName, createBrowser] of GESTURE_BROWSERS) {
  describe(`${browserName} requestSiteAccess`, () => {
    it("registers a content script and returns true on grant", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);

      const granted = await siteAccess.requestSiteAccess(
        "https://example.com/apply",
      );

      expect(granted).toBe(true);
      expect(fake.grantedOrigins.has("https://example.com/*")).toBe(true);
      expect(
        fake.registered.has(contentScriptIdFor("https://example.com/*")),
      ).toBe(true);
    });

    it("degrades without retrying when the user declines: a normal outcome", async () => {
      const fake = createBrowser({ grantResult: false });
      const siteAccess = createSiteAccess(fake);

      const granted = await siteAccess.requestSiteAccess(
        "https://example.com/apply",
      );

      expect(granted).toBe(false);
      expect(fake.grantedOrigins.size).toBe(0);
      expect(fake.registered.size).toBe(0);
    });

    it("injects into the active tab immediately when a tabId is given (spike 2's fix)", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);

      await siteAccess.requestSiteAccess("https://example.com/apply", 42);

      expect(fake.executedScripts).toEqual([
        { tabId: 42, files: ["content-scripts/content.js"] },
      ]);
    });

    it("does not inject anywhere when no tabId is given", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);

      await siteAccess.requestSiteAccess("https://example.com/apply");

      expect(fake.executedScripts).toEqual([]);
    });

    it("does not call the permission API for chrome:// or other non-http(s) URLs", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);

      expect(await siteAccess.requestSiteAccess("chrome://extensions")).toBe(
        false,
      );
      expect(await siteAccess.requestSiteAccess("about:addons")).toBe(false);
      expect(fake.requestCalls).toEqual([]);
    });

    it("does not re-prompt when the origin is already granted", async () => {
      const fake = createBrowser({
        grantedOrigins: new Set(["https://example.com/*"]),
      });
      const siteAccess = createSiteAccess(fake);

      const granted = await siteAccess.requestSiteAccess(
        "https://example.com/apply",
        3,
      );

      expect(granted).toBe(true);
      expect(fake.promptedOrigins).toEqual([]);
      expect(
        fake.registered.has(contentScriptIdFor("https://example.com/*")),
      ).toBe(true);
    });
  });

  describe(`${browserName} hasSiteAccess / revoke / restore`, () => {
    it("reflects the current grant state", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);

      expect(fake.grantedOrigins.size).toBe(0);
      await siteAccess.requestSiteAccess("https://example.com/apply");
      expect(await siteAccess.hasSiteAccess("https://example.com/apply")).toBe(
        true,
      );
    });

    it("treats an https wildcard as covering any https origin", async () => {
      const fake = createBrowser({
        grantedOrigins: new Set(["https://*/*"]),
      });
      const siteAccess = createSiteAccess(fake);

      expect(await siteAccess.hasSiteAccess("https://any.example/form")).toBe(
        true,
      );
      expect(await siteAccess.hasAllSiteAccess()).toBe(false);
    });

    it("removes the permission and unregisters the content script", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);
      await siteAccess.requestSiteAccess("https://example.com/apply");

      await siteAccess.revokeSiteAccess("https://example.com/apply");

      expect(fake.grantedOrigins.size).toBe(0);
      expect(fake.registered.size).toBe(0);
    });

    it("is idempotent: revoking an origin that was never granted does not throw", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);

      await expect(
        siteAccess.revokeSiteAccess("https://never-granted.example.com"),
      ).resolves.toBeUndefined();
    });

    it("re-registers a content script for every already-granted origin", async () => {
      const fake = createBrowser({
        grantedOrigins: new Set([
          "https://a.example.com/*",
          "https://b.example.com/*",
        ]),
      });
      const siteAccess = createSiteAccess(fake);

      const count = await siteAccess.restoreGrantedSites();

      expect(count).toBe(2);
      expect(fake.registered.size).toBe(2);
    });

    it("does not re-register a script that is already registered", async () => {
      const fake = createBrowser({
        grantedOrigins: new Set(["https://a.example.com/*"]),
      });
      const siteAccess = createSiteAccess(fake);

      await siteAccess.restoreGrantedSites();
      const registerCallsBefore = fake.registered.size;
      await siteAccess.restoreGrantedSites();

      expect(fake.registered.size).toBe(registerCallsBefore);
    });

    it("continues restore when one origin fails to register", async () => {
      const fake = createBrowser({
        grantedOrigins: new Set([
          "https://ok.example/*",
          "https://bad.example/*",
        ]),
      });
      fake.registerShouldThrow = (id) =>
        id === contentScriptIdFor("https://bad.example/*");
      const siteAccess = createSiteAccess(fake);

      await expect(siteAccess.restoreGrantedSites()).resolves.toBe(2);
      expect(
        fake.registered.has(contentScriptIdFor("https://ok.example/*")),
      ).toBe(true);
      expect(
        fake.registered.has(contentScriptIdFor("https://bad.example/*")),
      ).toBe(false);
    });

    it("registers distinct scripts for origins that would collide under alphanumeric squash", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);

      await siteAccess.requestSiteAccess("https://foo.bar.com/a");
      await siteAccess.requestSiteAccess("https://foo-bar.com/a");

      expect(fake.registered.size).toBe(2);
      await siteAccess.revokeSiteAccess("https://foo.bar.com/a");
      expect(
        fake.registered.has(contentScriptIdFor("https://foo-bar.com/*")),
      ).toBe(true);
    });
  });

  describe(`${browserName} listGrantedOrigins`, () => {
    it("lists every currently granted origin pattern", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);
      await siteAccess.requestSiteAccess("https://example.com/apply");
      await siteAccess.requestSiteAccess("https://forms.gov.example/x");

      const origins = (await siteAccess.listGrantedOrigins()).slice().sort();
      expect(origins).toEqual(
        ["https://example.com/*", "https://forms.gov.example/*"].sort(),
      );
    });

    it("reflects a revocation", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);
      await siteAccess.requestSiteAccess("https://example.com/apply");
      await siteAccess.revokeSiteAccess("https://example.com/apply");

      expect(await siteAccess.listGrantedOrigins()).toEqual([]);
    });
  });

  describe(`${browserName} requestAllSiteAccess`, () => {
    it("registers a global content script for both wildcard patterns", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);

      const granted = await siteAccess.requestAllSiteAccess(7);

      expect(granted).toBe(true);
      for (const pattern of ALL_SITE_ORIGINS) {
        expect(fake.grantedOrigins.has(pattern)).toBe(true);
      }
      expect(fake.registered.has("form-agent-content:all_sites")).toBe(true);
      expect(fake.executedScripts).toEqual([
        { tabId: 7, files: ["content-scripts/content.js"] },
      ]);
    });

    it("restoreGrantedSites registers global scripts when wildcards are granted", async () => {
      const fake = createBrowser({
        grantedOrigins: new Set([...ALL_SITE_ORIGINS]),
      });
      const siteAccess = createSiteAccess(fake);

      await expect(siteAccess.restoreGrantedSites()).resolves.toBe(2);
      expect(fake.registered.has(GLOBAL_HTTPS_SCRIPT_ID)).toBe(true);
      expect(fake.registered.has(GLOBAL_HTTP_SCRIPT_ID)).toBe(true);
    });

    it("syncScriptsForGrantedAccess registers scripts without calling request", async () => {
      const fake = createBrowser({
        grantedOrigins: new Set(["https://example.com/*"]),
      });
      const siteAccess = createSiteAccess(fake);

      await siteAccess.syncScriptsForGrantedAccess(
        "https://example.com/form",
        12,
      );

      expect(fake.requestCalls).toEqual([]);
      expect(fake.registered.size).toBe(1);
      expect(fake.executedScripts).toEqual([
        { tabId: 12, files: ["content-scripts/content.js"] },
      ]);
    });

    it("still returns true when global script registration throws after a grant", async () => {
      const fake = createBrowser();
      fake.registerShouldThrow = () => true;
      const siteAccess = createSiteAccess(fake);

      await expect(siteAccess.requestAllSiteAccess()).resolves.toBe(true);
      expect(fake.grantedOrigins.has("https://*/*")).toBe(true);
    });

    it("still returns true when immediate injection fails after a grant", async () => {
      const fake = createBrowser();
      fake.scripting.executeScript = async () => {
        throw new Error("Cannot access a chrome:// URL");
      };
      const siteAccess = createSiteAccess(fake);

      await expect(siteAccess.requestAllSiteAccess(99)).resolves.toBe(true);
      expect(fake.grantedOrigins.has("https://*/*")).toBe(true);
    });

    it("hasSiteAccess is true for any https origin when all sites are granted", async () => {
      const fake = createBrowser({
        grantedOrigins: new Set([...ALL_SITE_ORIGINS]),
      });
      const siteAccess = createSiteAccess(fake);

      expect(await siteAccess.hasSiteAccess("https://any.example/form")).toBe(
        true,
      );
    });

    it("registers the remaining wildcard when only one global script id exists", async () => {
      const fake = createBrowser({
        registered: new Set([GLOBAL_HTTPS_SCRIPT_ID]),
        grantedOrigins: new Set([...ALL_SITE_ORIGINS]),
      });
      fake.registerShouldThrow = (id) => id === "form-agent-content:all_sites";
      const siteAccess = createSiteAccess(fake);

      await siteAccess.restoreGrantedSites();

      expect(fake.registered.has(GLOBAL_HTTPS_SCRIPT_ID)).toBe(true);
      expect(fake.registered.has(GLOBAL_HTTP_SCRIPT_ID)).toBe(true);
    });
  });

  describe(`${browserName} permissions.onAdded / onRemoved`, () => {
    it("registers scripts when the browser grants origins outside the panel", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);
      wireSiteAccessPermissionEvents(fake, siteAccess);

      fake.emitAdded(["https://settings.example/*"]);
      await Promise.resolve();

      expect(
        fake.registered.has(contentScriptIdFor("https://settings.example/*")),
      ).toBe(true);
    });

    it("unregisters scripts when the browser revokes origins outside the panel", async () => {
      const fake = createBrowser();
      const siteAccess = createSiteAccess(fake);
      wireSiteAccessPermissionEvents(fake, siteAccess);
      await siteAccess.requestSiteAccess("https://settings.example/form");

      fake.emitRemoved(["https://settings.example/*"]);
      await Promise.resolve();

      expect(fake.registered.size).toBe(0);
      expect(fake.grantedOrigins.size).toBe(0);
    });
  });
}

describe("Chrome callback API", () => {
  it("uses Chrome's callback API directly when available", async () => {
    const fake = createChromeFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    const granted = await siteAccess.requestSiteAccess(
      "https://example.com/apply",
      42,
    );

    expect(granted).toBe(true);
    expect(fake.requestCalls).toEqual([["https://example.com/*"]]);
    expect(fake.grantedOrigins.has("https://example.com/*")).toBe(true);
    expect(fake.registered.size).toBe(1);
    expect(fake.executedScripts).toEqual([
      { tabId: 42, files: ["content-scripts/content.js"] },
    ]);
  });
});

describe("Firefox gesture policy", () => {
  it("fails permissions.request after contains() has yielded", async () => {
    const fake = createFirefoxFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    await siteAccess.hasSiteAccess("https://example.com/apply");

    await expect(
      siteAccess.requestSiteAccess("https://example.com/apply"),
    ).rejects.toThrow(GESTURE_ERROR);
    expect(fake.grantedOrigins.size).toBe(0);
  });

  it("succeeds when request() is the first await", async () => {
    const fake = createFirefoxFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    expect(
      await siteAccess.requestSiteAccess("https://firefox.example/apply", 109),
    ).toBe(true);
    expect(fake.grantedOrigins.has("https://firefox.example/*")).toBe(true);
    expect(
      fake.registered.has(contentScriptIdFor("https://firefox.example/*")),
    ).toBe(true);
  });
});

describe("Chrome gesture policy", () => {
  it("still grants after contains() because Chrome keeps user activation", async () => {
    const fake = createChromeFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    await siteAccess.hasSiteAccess("https://example.com/apply");
    expect(
      await siteAccess.requestSiteAccess("https://example.com/apply"),
    ).toBe(true);
  });
});

describe("plain promise fake (default)", () => {
  it("still supports grant without a Chrome callback object", async () => {
    const fake = createFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    expect(await siteAccess.requestSiteAccess("https://example.com/x")).toBe(
      true,
    );
  });
});
