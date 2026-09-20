import { describe, expect, it } from "bun:test";
import {
  createSiteAccess,
  type SiteAccessBrowser,
  toOriginPattern,
} from "~/lib/site-access";

/**
 * A hand-written fake, not a mocking library: this is the mechanism the
 * entire privacy claim rests on, so the test should read as plainly as the
 * production code does. State lives in plain objects so a test can inspect
 * it directly rather than asserting on call-spy internals.
 */
const createFakeBrowser = (
  overrides: Partial<{
    grantResult: boolean;
    registered: Set<string>;
    grantedOrigins: Set<string>;
    executedScripts: { tabId: number; files: string[] }[];
    chromePermissions: SiteAccessBrowser["chromePermissions"];
    chromeRuntime: SiteAccessBrowser["chromeRuntime"];
  }> = {},
): SiteAccessBrowser & {
  registered: Set<string>;
  grantedOrigins: Set<string>;
  executedScripts: { tabId: number; files: string[] }[];
} => {
  const registered = overrides.registered ?? new Set<string>();
  const grantedOrigins = overrides.grantedOrigins ?? new Set<string>();
  const executedScripts = overrides.executedScripts ?? [];
  const grantResult = overrides.grantResult ?? true;

  return {
    registered,
    grantedOrigins,
    executedScripts,
    chromePermissions: overrides.chromePermissions,
    chromeRuntime: overrides.chromeRuntime,
    permissions: {
      async contains({ origins }) {
        return origins.every((o) => grantedOrigins.has(o));
      },
      async request({ origins }) {
        if (!grantResult) return false;
        for (const o of origins) grantedOrigins.add(o);
        return true;
      },
      async remove({ origins }) {
        for (const o of origins) grantedOrigins.delete(o);
        return true;
      },
      async getAll() {
        return { origins: Array.from(grantedOrigins) };
      },
    },
    scripting: {
      async registerContentScripts(scripts) {
        for (const script of scripts) registered.add(script.id);
      },
      async unregisterContentScripts({ ids }) {
        for (const id of ids) registered.delete(id);
      },
      async getRegisteredContentScripts({ ids }) {
        return ids.filter((id) => registered.has(id));
      },
      async executeScript({ target, files }) {
        executedScripts.push({ tabId: target.tabId, files: [...files] });
        return undefined;
      },
    },
  };
};

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

describe("requestSiteAccess", () => {
  it("registers a content script and returns true on grant", async () => {
    const fake = createFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    const granted = await siteAccess.requestSiteAccess(
      "https://example.com/apply",
    );

    expect(granted).toBe(true);
    expect(fake.grantedOrigins.has("https://example.com/*")).toBe(true);
    expect(fake.registered.size).toBe(1);
  });

  it("degrades without retrying when the user declines: a normal outcome", async () => {
    const fake = createFakeBrowser({ grantResult: false });
    const siteAccess = createSiteAccess(fake);

    const granted = await siteAccess.requestSiteAccess(
      "https://example.com/apply",
    );

    expect(granted).toBe(false);
    expect(fake.grantedOrigins.size).toBe(0);
    expect(fake.registered.size).toBe(0);
  });

  it("injects into the active tab immediately when a tabId is given (spike 2's fix)", async () => {
    const fake = createFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    await siteAccess.requestSiteAccess("https://example.com/apply", 42);

    expect(fake.executedScripts).toEqual([
      { tabId: 42, files: ["content-scripts/content.js"] },
    ]);
  });

  it("does not inject anywhere when no tabId is given", async () => {
    const fake = createFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    await siteAccess.requestSiteAccess("https://example.com/apply");

    expect(fake.executedScripts).toEqual([]);
  });

  it("uses Chrome's callback API directly when available", async () => {
    const requestedOrigins: string[][] = [];
    const fake = createFakeBrowser({
      chromeRuntime: {},
      chromePermissions: {
        request(query, callback) {
          requestedOrigins.push([...query.origins]);
          callback(true);
        },
      },
    });
    const siteAccess = createSiteAccess(fake);

    const granted = await siteAccess.requestSiteAccess(
      "https://example.com/apply",
      42,
    );

    expect(granted).toBe(true);
    expect(requestedOrigins).toEqual([["https://example.com/*"]]);
    expect(fake.registered.size).toBe(1);
    expect(fake.executedScripts).toEqual([
      { tabId: 42, files: ["content-scripts/content.js"] },
    ]);
  });
});

describe("hasSiteAccess", () => {
  it("reflects the current grant state", async () => {
    const fake = createFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    expect(await siteAccess.hasSiteAccess("https://example.com/apply")).toBe(
      false,
    );
    await siteAccess.requestSiteAccess("https://example.com/apply");
    expect(await siteAccess.hasSiteAccess("https://example.com/apply")).toBe(
      true,
    );
  });
});

describe("revokeSiteAccess", () => {
  it("removes the permission and unregisters the content script", async () => {
    const fake = createFakeBrowser();
    const siteAccess = createSiteAccess(fake);
    await siteAccess.requestSiteAccess("https://example.com/apply");

    await siteAccess.revokeSiteAccess("https://example.com/apply");

    expect(fake.grantedOrigins.size).toBe(0);
    expect(fake.registered.size).toBe(0);
  });

  it("is idempotent: revoking an origin that was never granted does not throw", async () => {
    const fake = createFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    await expect(
      siteAccess.revokeSiteAccess("https://never-granted.example.com"),
    ).resolves.toBeUndefined();
  });
});

describe("restoreGrantedSites", () => {
  it("re-registers a content script for every already-granted origin", async () => {
    const fake = createFakeBrowser({
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
    const fake = createFakeBrowser({
      grantedOrigins: new Set(["https://a.example.com/*"]),
    });
    const siteAccess = createSiteAccess(fake);

    await siteAccess.restoreGrantedSites();
    const registerCallsBefore = fake.registered.size;
    await siteAccess.restoreGrantedSites();

    expect(fake.registered.size).toBe(registerCallsBefore);
  });
});

describe("listGrantedOrigins", () => {
  it("lists every currently granted origin pattern", async () => {
    const fake = createFakeBrowser();
    const siteAccess = createSiteAccess(fake);
    await siteAccess.requestSiteAccess("https://example.com/apply");
    await siteAccess.requestSiteAccess("https://forms.gov.example/x");

    const origins = (await siteAccess.listGrantedOrigins()).slice().sort();
    expect(origins).toEqual(
      ["https://example.com/*", "https://forms.gov.example/*"].sort(),
    );
  });

  it("reflects a revocation", async () => {
    const fake = createFakeBrowser();
    const siteAccess = createSiteAccess(fake);
    await siteAccess.requestSiteAccess("https://example.com/apply");
    await siteAccess.revokeSiteAccess("https://example.com/apply");

    expect(await siteAccess.listGrantedOrigins()).toEqual([]);
  });
});

describe("Firefox MV3-shaped browser", () => {
  it("uses the same optional-origin grant and scripting registration path", async () => {
    const fake = createFakeBrowser();
    const siteAccess = createSiteAccess(fake);

    const granted = await siteAccess.requestSiteAccess(
      "https://firefox.example/apply",
      109,
    );

    expect(granted).toBe(true);
    expect(fake.grantedOrigins.has("https://firefox.example/*")).toBe(true);
    expect(
      fake.registered.has("form-agent-content:https___firefox_example__"),
    ).toBe(true);
    expect(fake.executedScripts).toEqual([
      { tabId: 109, files: ["content-scripts/content.js"] },
    ]);
  });

  it("restores and revokes Firefox MV3 runtime registrations by origin id", async () => {
    const fake = createFakeBrowser({
      grantedOrigins: new Set(["https://firefox.example/*"]),
    });
    const siteAccess = createSiteAccess(fake);

    await expect(siteAccess.restoreGrantedSites()).resolves.toBe(1);
    expect(
      fake.registered.has("form-agent-content:https___firefox_example__"),
    ).toBe(true);

    await siteAccess.revokeSiteAccess("https://firefox.example/apply");

    expect(fake.grantedOrigins.size).toBe(0);
    expect(fake.registered.size).toBe(0);
  });
});
