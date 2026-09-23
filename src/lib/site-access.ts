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

export interface PermissionOriginsChange {
  readonly origins?: readonly string[];
}

/** The slice of the WebExtension `browser` API this module needs. Nothing more. */
export interface SiteAccessBrowser {
  readonly chromePermissions?: {
    request(
      query: { origins: string[] },
      callback: (granted: boolean) => void,
    ): void;
  };
  readonly chromeRuntime?: {
    readonly lastError?: { readonly message?: string };
  };
  readonly permissions: {
    contains(query: { origins: string[] }): Promise<boolean>;
    request(query: { origins: string[] }): Promise<boolean>;
    remove(query: { origins: string[] }): Promise<boolean>;
    getAll(): Promise<{ origins?: string[] }>;
    readonly onAdded?: {
      addListener(callback: (change: PermissionOriginsChange) => void): void;
      removeListener?(
        callback: (change: PermissionOriginsChange) => void,
      ): void;
    };
    readonly onRemoved?: {
      addListener(callback: (change: PermissionOriginsChange) => void): void;
      removeListener?(
        callback: (change: PermissionOriginsChange) => void,
      ): void;
    };
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
const GLOBAL_CONTENT_SCRIPT_ID = "form-agent-content:all_sites";
export const GLOBAL_HTTPS_SCRIPT_ID = "form-agent-content:all_sites:https";
export const GLOBAL_HTTP_SCRIPT_ID = "form-agent-content:all_sites:http";

const GLOBAL_SCRIPT_IDS = [
  GLOBAL_CONTENT_SCRIPT_ID,
  GLOBAL_HTTPS_SCRIPT_ID,
  GLOBAL_HTTP_SCRIPT_ID,
] as const;
const CONTENT_SCRIPT_JS = ["content-scripts/content.js"];
const CONTENT_SCRIPT_CSS = ["content-scripts/content.css"];

/** Runtime grant for passive detection on arbitrary http(s) pages. */
export const ALL_SITE_ORIGINS = ["https://*/*", "http://*/*"] as const;

export const isAllSiteOriginPattern = (pattern: string): boolean =>
  (ALL_SITE_ORIGINS as readonly string[]).includes(pattern);

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
export const isPermissibleUrl = (url: string): boolean => {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
};

/**
 * Reversible, collision-free content-script id for one origin pattern.
 * `https://foo.bar.com/*` and `https://foo-bar.com/*` must not share an id.
 */
export const contentScriptIdFor = (origin: string): string => {
  const bytes = new TextEncoder().encode(origin);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${CONTENT_SCRIPT_ID}:${encoded}`;
};

/** Chrome: "Duplicate script ID '…'". Firefox: "already registered". */
export const isDuplicateScriptIdError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate script id|already registered/i.test(message);
};

const requestOriginsFromGesture = (
  browser: SiteAccessBrowser,
  origins: string[],
): Promise<boolean> => {
  const request = browser.chromePermissions?.request;

  if (request) {
    return new Promise((resolve, reject) => {
      request.call(browser.chromePermissions, { origins }, (granted) => {
        const message = browser.chromeRuntime?.lastError?.message;
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

/**
 * `injected` is `false` when no tab was given, access is not held, or the
 * browser refused injection (browser stores, PDF viewers, error pages).
 */
export interface SyncScriptsResult {
  readonly injected: boolean;
}

export interface SiteAccess {
  hasAllSiteAccess(): Promise<boolean>;
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
  /**
   * Requests read access to all http(s) sites. Must run from a user gesture
   * (first-run gate or settings). Registers content scripts for both
   * wildcard patterns.
   */
  requestAllSiteAccess(activeTabId?: number): Promise<boolean>;
  revokeSiteAccess(url: string): Promise<void>;
  revokeAllSiteAccess(): Promise<void>;
  /**
   * Re-registers scripts for every origin the user has already granted.
   * Call on startup: runtime registrations do not survive a browser
   * restart, but the permission grants do.
   */
  restoreGrantedSites(): Promise<number>;
  /**
   * Re-registers and injects content scripts when permission is already
   * granted but runtime registration was lost (no permission prompt).
   */
  syncScriptsForGrantedAccess(
    url: string,
    activeTabId?: number,
  ): Promise<SyncScriptsResult>;
  /** Every origin-pattern the user has granted. Powers the panel's "revoke" list. */
  listGrantedOrigins(): Promise<readonly string[]>;
  /** Browser UI or another context granted origins — register without prompting. */
  handleOriginsAdded(origins: readonly string[]): Promise<void>;
  /** Browser UI revoked origins — unregister scripts; permission is already gone. */
  handleOriginsRemoved(origins: readonly string[]): Promise<void>;
}

export const createSiteAccess = (browser: SiteAccessBrowser): SiteAccess => {
  const registerOneContentScript = async (
    id: string,
    matches: string[],
  ): Promise<void> => {
    const existing = await browser.scripting.getRegisteredContentScripts({
      ids: [id],
    });
    if (existing.length > 0) return;

    try {
      await browser.scripting.registerContentScripts([
        {
          id,
          matches,
          js: CONTENT_SCRIPT_JS,
          css: CONTENT_SCRIPT_CSS,
          runAt: "document_idle",
        },
      ]);
    } catch (error) {
      // Background onAdded and the Scan path can both pass the empty-list
      // check, then the loser throws. The script is already registered.
      if (isDuplicateScriptIdError(error)) return;
      throw error;
    }
  };

  const registerGlobalContentScript = async (
    patterns: readonly string[] = ALL_SITE_ORIGINS,
  ): Promise<void> => {
    const wantsHttps = patterns.includes("https://*/*");
    const wantsHttp = patterns.includes("http://*/*");

    if (wantsHttps && wantsHttp) {
      try {
        await registerOneContentScript(GLOBAL_CONTENT_SCRIPT_ID, [
          ...ALL_SITE_ORIGINS,
        ]);
        return;
      } catch {
        // Some builds reject two wildcards in one registration — register separately.
      }
    }

    if (wantsHttps) {
      await registerOneContentScript(GLOBAL_HTTPS_SCRIPT_ID, ["https://*/*"]);
    }
    if (wantsHttp) {
      await registerOneContentScript(GLOBAL_HTTP_SCRIPT_ID, ["http://*/*"]);
    }
  };

  const unregisterForOrigin = async (origin: string): Promise<void> => {
    if (origin === "https://*/*") {
      await browser.scripting
        .unregisterContentScripts({
          ids: [GLOBAL_CONTENT_SCRIPT_ID, GLOBAL_HTTPS_SCRIPT_ID],
        })
        .catch(() => {});
      return;
    }
    if (origin === "http://*/*") {
      await browser.scripting
        .unregisterContentScripts({
          ids: [GLOBAL_CONTENT_SCRIPT_ID, GLOBAL_HTTP_SCRIPT_ID],
        })
        .catch(() => {});
      return;
    }
    await browser.scripting
      .unregisterContentScripts({ ids: [contentScriptIdFor(origin)] })
      .catch(() => {});
  };

  const registerForOrigin = async (origin: string): Promise<void> => {
    if (isAllSiteOriginPattern(origin)) {
      await registerGlobalContentScript([origin]);
      return;
    }

    await registerOneContentScript(contentScriptIdFor(origin), [origin]);
  };

  /**
   * Best-effort injection into the tab that was active when the user granted
   * access. That tab is often not injectable (chrome://, Web Store, PDF, etc.)
   * even after a successful permission grant — registration still covers future
   * navigations, so a failure here must not reject the grant.
   */
  const injectContentScript = async (activeTabId: number): Promise<boolean> => {
    try {
      await browser.scripting.executeScript({
        target: { tabId: activeTabId },
        files: CONTENT_SCRIPT_JS,
      });
      return true;
    } catch {
      // Non-fatal — see comment above. Reported so callers can tell a
      // granted-but-unscriptable page from a missing grant.
      return false;
    }
  };

  return {
    hasAllSiteAccess: () =>
      browser.permissions.contains({ origins: [...ALL_SITE_ORIGINS] }),

    hasSiteAccess: async (url) => {
      if (!isPermissibleUrl(url)) return false;
      return browser.permissions.contains({
        origins: [toOriginPattern(url)],
      });
    },

    async requestSiteAccess(url, activeTabId) {
      if (!isPermissibleUrl(url)) return false;
      const origin = toOriginPattern(url);

      const granted = await requestOriginsFromGesture(browser, [origin]);
      if (!granted) return false;

      try {
        await registerForOrigin(origin);
      } catch {
        // Grant succeeded; runtime registration is best-effort.
      }

      if (activeTabId !== undefined) {
        await injectContentScript(activeTabId);
      }

      return true;
    },

    async requestAllSiteAccess(activeTabId) {
      const granted = await requestOriginsFromGesture(browser, [
        ...ALL_SITE_ORIGINS,
      ]);
      if (!granted) return false;

      try {
        await registerGlobalContentScript();

        if (activeTabId !== undefined) {
          await injectContentScript(activeTabId);
        }
      } catch {
        // Grant succeeded; runtime registration/inject is best-effort.
      }

      return true;
    },

    async revokeSiteAccess(url) {
      const origin = isAllSiteOriginPattern(url) ? url : toOriginPattern(url);

      if (isAllSiteOriginPattern(origin)) {
        await browser.scripting
          .unregisterContentScripts({ ids: [...GLOBAL_SCRIPT_IDS] })
          .catch(() => {});
        await browser.permissions.remove({ origins: [...ALL_SITE_ORIGINS] });
        return;
      }

      await unregisterForOrigin(origin);
      await browser.permissions.remove({ origins: [origin] });
    },

    async revokeAllSiteAccess() {
      await browser.scripting
        .unregisterContentScripts({ ids: [...GLOBAL_SCRIPT_IDS] })
        .catch(() => {});
      await browser.permissions.remove({ origins: [...ALL_SITE_ORIGINS] });
    },

    async syncScriptsForGrantedAccess(url, activeTabId) {
      if (!isPermissibleUrl(url)) return { injected: false };
      const origin = toOriginPattern(url);
      const hasOrigin = await browser.permissions.contains({
        origins: [origin],
      });
      if (!hasOrigin) return { injected: false };

      const protocol = new URL(url).protocol;
      const hasHttpsAll = await browser.permissions.contains({
        origins: ["https://*/*"],
      });
      const hasHttpAll = await browser.permissions.contains({
        origins: ["http://*/*"],
      });

      if (protocol === "https:" && hasHttpsAll) {
        await registerGlobalContentScript(["https://*/*"]);
      } else if (protocol === "http:" && hasHttpAll) {
        await registerGlobalContentScript(["http://*/*"]);
      } else {
        await registerForOrigin(origin);
      }

      const injected =
        activeTabId !== undefined
          ? await injectContentScript(activeTabId)
          : false;
      return { injected };
    },

    async restoreGrantedSites() {
      const { origins = [] } = await browser.permissions.getAll();
      await Promise.allSettled(origins.map(registerForOrigin));
      return origins.length;
    },

    async listGrantedOrigins() {
      const { origins = [] } = await browser.permissions.getAll();
      return origins;
    },

    async handleOriginsAdded(origins) {
      await Promise.allSettled(origins.map(registerForOrigin));
    },

    async handleOriginsRemoved(origins) {
      await Promise.allSettled(origins.map(unregisterForOrigin));
    },
  };
};

export const wireSiteAccessPermissionEvents = (
  browser: SiteAccessBrowser,
  access: SiteAccess,
): void => {
  browser.permissions.onAdded?.addListener((change) => {
    void access.handleOriginsAdded(change.origins ?? []);
  });
  browser.permissions.onRemoved?.addListener((change) => {
    void access.handleOriginsRemoved(change.origins ?? []);
  });
};

/** The real, wired-up instance. Use this everywhere except tests. */
export const siteAccess: SiteAccess = createSiteAccess({
  ...(realBrowser as unknown as SiteAccessBrowser),
  chromePermissions: (
    globalThis as typeof globalThis & {
      readonly chrome?: {
        readonly permissions?: SiteAccessBrowser["chromePermissions"];
      };
    }
  ).chrome?.permissions,
  chromeRuntime: (
    globalThis as typeof globalThis & {
      readonly chrome?: {
        readonly runtime?: SiteAccessBrowser["chromeRuntime"];
      };
    }
  ).chrome?.runtime,
});
