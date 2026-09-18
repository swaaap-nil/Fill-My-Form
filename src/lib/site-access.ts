import { browser as realBrowser } from "wxt/browser";

/**
 * Per-site access, granted by the user, one origin at a time.
 *
 * The extension ships with no host permissions (see `wxt.config.ts`). Nothing
 * runs on a page until the user grants access to that page's origin, at which
 * point the content script is registered for that origin only.
 *
 * This is the runtime half of the privacy boundary described in
 * docs/privacy.md; the manifest is the static half.
 *
 * **Dependency-injected.** Everything here took `wxt/browser` at module
 * scope until phase 1c, which gave this file zero unit coverage despite
 * being the mechanism the entire privacy claim rests on. Every export now
 * takes a `SiteAccessBrowser` explicitly — `createSiteAccess(realBrowser)`
 * at the real call site, a hand-written fake in tests.
 */

/** The slice of the WebExtension `browser` API this module needs. Nothing more. */
export interface SiteAccessBrowser {
  readonly permissions: {
    contains(query: { origins: string[] }): Promise<boolean>;
    request(query: { origins: string[] }): Promise<boolean>;
    remove(query: { origins: string[] }): Promise<boolean>;
    getAll(): Promise<{ origins?: string[] }>;
  };
  readonly scripting: {
    registerContentScripts(
      scripts: readonly {
        id: string;
        matches: string[];
        js: string[];
        css?: string[];
        runAt?: "document_start" | "document_end" | "document_idle";
      }[],
    ): Promise<void>;
    unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
    getRegisteredContentScripts(filter: {
      ids: string[];
    }): Promise<readonly unknown[]>;
    executeScript(injection: {
      target: { tabId: number };
      files: string[];
    }): Promise<unknown>;
  };
}

const CONTENT_SCRIPT_ID = "form-agent-content";
const CONTENT_SCRIPT_JS = ["content-scripts/content.js"];
const CONTENT_SCRIPT_CSS = ["content-scripts/content.css"];

/** `https://example.com/path?q=1` -> `https://example.com/*` */
export const toOriginPattern = (url: string): string =>
  `${new URL(url).origin}/*`;

/**
 * Match patterns (and thus `permissions.contains`/`request`) only accept
 * http/https/file/ftp schemes. Tabs showing the extension's own pages,
 * `chrome://`, `about:`, etc. fail `new URL(url).protocol` checks silently
 * in some browsers and log an "Invalid scheme" console error in others —
 * treat them as never having site access rather than querying for one.
 */
const isPermissibleUrl = (url: string): boolean => {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
};

const scriptIdFor = (origin: string) =>
  `${CONTENT_SCRIPT_ID}:${origin.replace(/[^a-zA-Z0-9]/g, "_")}`;

type ChromePermissionsRequest = (
  query: { origins: string[] },
  callback: (granted: boolean) => void,
) => void;

const requestOriginsFromGesture = (
  browser: SiteAccessBrowser,
  origins: string[],
): Promise<boolean> => {
  const chromeLike = globalThis as typeof globalThis & {
    chrome?: {
      runtime?: { lastError?: { message?: string } };
      permissions?: { request?: ChromePermissionsRequest };
    };
  };
  const chromePermissions = chromeLike.chrome?.permissions;
  const request = chromePermissions?.request;

  if (request) {
    return new Promise((resolve, reject) => {
      request({ origins }, (granted) => {
        const message = chromeLike.chrome?.runtime?.lastError?.message;
        if (message) {
          reject(new Error(message));
          return;
        }
        resolve(granted);
      });
    });
  }

  return browser.permissions.request({ origins });
};

export interface SiteAccess {
  hasSiteAccess(url: string): Promise<boolean>;
  /**
   * Must be called from a user gesture — Chrome rejects `permissions.request`
   * otherwise. Returns false if the user declines; that is a normal outcome
   * and the caller should degrade rather than retry.
   *
   * `activeTabId`, when given, is injected into directly after a successful
   * grant (`chrome.scripting.executeScript`) so the tab that is already open
   * shows the content script immediately. Without this, `registerContentScripts`
   * only affects *future* navigations — confirmed in Phase 0 spike 2 — and the
   * user sees nothing until they reload the very tab they just granted.
   */
  requestSiteAccess(url: string, activeTabId?: number): Promise<boolean>;
  revokeSiteAccess(url: string): Promise<void>;
  /**
   * Re-registers scripts for every origin the user has already granted.
   * Call on startup: runtime registrations do not survive a browser
   * restart, but the permission grants do.
   */
  restoreGrantedSites(): Promise<number>;
  /** Every origin-pattern the user has granted. Powers the panel's "revoke" list. */
  listGrantedOrigins(): Promise<readonly string[]>;
}

export const createSiteAccess = (browser: SiteAccessBrowser): SiteAccess => {
  const registerForOrigin = async (origin: string): Promise<void> => {
    const id = scriptIdFor(origin);

    const existing = await browser.scripting.getRegisteredContentScripts({
      ids: [id],
    });
    if (existing.length > 0) return;

    await browser.scripting.registerContentScripts([
      {
        id,
        matches: [origin],
        js: CONTENT_SCRIPT_JS,
        css: CONTENT_SCRIPT_CSS,
        runAt: "document_idle",
      },
    ]);
  };

  return {
    hasSiteAccess: (url) =>
      isPermissibleUrl(url)
        ? browser.permissions.contains({ origins: [toOriginPattern(url)] })
        : Promise.resolve(false),

    async requestSiteAccess(url, activeTabId) {
      const origin = toOriginPattern(url);

      const granted = await requestOriginsFromGesture(browser, [origin]);
      if (!granted) return false;

      await registerForOrigin(origin);

      if (activeTabId !== undefined) {
        // Covers the tab that is open right now; registration above covers
        // every navigation after this one.
        await browser.scripting.executeScript({
          target: { tabId: activeTabId },
          files: CONTENT_SCRIPT_JS,
        });
      }

      return true;
    },

    async revokeSiteAccess(url) {
      const origin = toOriginPattern(url);

      await browser.scripting
        .unregisterContentScripts({ ids: [scriptIdFor(origin)] })
        .catch(() => {
          // Not registered. Revoking is idempotent by design.
        });
      await browser.permissions.remove({ origins: [origin] });
    },

    async restoreGrantedSites() {
      const { origins = [] } = await browser.permissions.getAll();
      await Promise.all(origins.map(registerForOrigin));
      return origins.length;
    },

    async listGrantedOrigins() {
      const { origins = [] } = await browser.permissions.getAll();
      return origins;
    },
  };
};

/** The real, wired-up instance. Use this everywhere except tests. */
export const siteAccess: SiteAccess = createSiteAccess(
  realBrowser as unknown as SiteAccessBrowser,
);
