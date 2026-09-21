import type {
  PermissionOriginsChange,
  SiteAccessBrowser,
} from "~/lib/site-access";
import { ALL_SITE_ORIGINS } from "~/lib/site-access";

/**
 * Hand-written fakes of the slice of `browser` that `createSiteAccess` uses.
 * Chrome vs Firefox differ in two ways this product actually hits:
 * - Chrome: callback `chrome.permissions.request` and a user-gesture that
 *   often survives one `await`.
 * - Firefox: promise `browser.permissions.request` and a user-gesture that
 *   dies as soon as control returns to the event loop.
 */

export type GesturePolicy = "chrome" | "firefox";

const GESTURE_ERROR = "This function must be called during a user gesture";

export const originCoveredByGrant = (
  origin: string,
  granted: ReadonlySet<string>,
): boolean => {
  if (granted.has(origin)) return true;
  if (origin.startsWith("https:") && granted.has("https://*/*")) return true;
  if (
    origin.startsWith("http:") &&
    !origin.startsWith("https:") &&
    granted.has("http://*/*")
  ) {
    return true;
  }
  return false;
};

export interface FakeSiteAccessBrowser extends SiteAccessBrowser {
  readonly registered: Set<string>;
  readonly grantedOrigins: Set<string>;
  readonly executedScripts: { tabId: number; files: string[] }[];
  readonly requestCalls: string[][];
  readonly promptedOrigins: string[][];
  userInputLive: boolean;
  registerShouldThrow?: (id: string) => boolean;
  emitAdded(origins: readonly string[]): void;
  emitRemoved(origins: readonly string[]): void;
}

export const createFakeBrowser = (
  overrides: Partial<{
    grantResult: boolean;
    registered: Set<string>;
    grantedOrigins: Set<string>;
    executedScripts: { tabId: number; files: string[] }[];
    gesturePolicy: GesturePolicy;
    useChromeCallback: boolean;
    chromeRuntime: SiteAccessBrowser["chromeRuntime"];
  }> = {},
): FakeSiteAccessBrowser => {
  const registered = overrides.registered ?? new Set<string>();
  const grantedOrigins = overrides.grantedOrigins ?? new Set<string>();
  const executedScripts = overrides.executedScripts ?? [];
  const grantResult = overrides.grantResult ?? true;
  const gesturePolicy = overrides.gesturePolicy ?? "chrome";
  const requestCalls: string[][] = [];
  const promptedOrigins: string[][] = [];
  const addedListeners: Array<(change: PermissionOriginsChange) => void> = [];
  const removedListeners: Array<(change: PermissionOriginsChange) => void> = [];

  let lastError: { message?: string } | undefined =
    overrides.chromeRuntime?.lastError !== undefined
      ? { ...overrides.chromeRuntime.lastError }
      : undefined;

  const requestOrigins = async (origins: string[]): Promise<boolean> => {
    requestCalls.push([...origins]);
    const already = origins.every((origin) =>
      originCoveredByGrant(origin, grantedOrigins),
    );
    if (already) return true;

    if (gesturePolicy === "firefox" && !fake.userInputLive) {
      throw new Error(GESTURE_ERROR);
    }

    promptedOrigins.push([...origins]);
    if (!grantResult) return false;
    for (const origin of origins) grantedOrigins.add(origin);
    return true;
  };

  const fake: FakeSiteAccessBrowser = {
    registered,
    grantedOrigins,
    executedScripts,
    requestCalls,
    promptedOrigins,
    userInputLive: true,
    chromeRuntime: {
      get lastError() {
        return lastError;
      },
    },
    ...(overrides.useChromeCallback
      ? {
          chromePermissions: {
            request(
              query: { origins: string[] },
              callback: (granted: boolean) => void,
            ) {
              void requestOrigins(query.origins)
                .then((granted) => {
                  lastError = undefined;
                  callback(granted);
                })
                .catch((error: unknown) => {
                  lastError = {
                    message:
                      error instanceof Error ? error.message : String(error),
                  };
                  callback(false);
                });
            },
          },
        }
      : {}),
    permissions: {
      async contains({ origins }) {
        if (gesturePolicy === "firefox") {
          fake.userInputLive = false;
        }
        return origins.every((origin) =>
          originCoveredByGrant(origin, grantedOrigins),
        );
      },
      async request({ origins }) {
        return requestOrigins(origins);
      },
      async remove({ origins }) {
        for (const origin of origins) grantedOrigins.delete(origin);
        return true;
      },
      async getAll() {
        return { origins: Array.from(grantedOrigins) };
      },
      onAdded: {
        addListener(callback) {
          addedListeners.push(callback);
        },
        removeListener(callback) {
          const index = addedListeners.indexOf(callback);
          if (index >= 0) addedListeners.splice(index, 1);
        },
      },
      onRemoved: {
        addListener(callback) {
          removedListeners.push(callback);
        },
        removeListener(callback) {
          const index = removedListeners.indexOf(callback);
          if (index >= 0) removedListeners.splice(index, 1);
        },
      },
    },
    scripting: {
      async registerContentScripts(scripts) {
        for (const script of scripts) {
          if (fake.registerShouldThrow?.(script.id)) {
            throw new Error(`registration failed: ${script.id}`);
          }
          registered.add(script.id);
        }
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
    emitAdded(origins) {
      for (const origin of origins) grantedOrigins.add(origin);
      for (const listener of addedListeners) {
        listener({ origins: [...origins] });
      }
    },
    emitRemoved(origins) {
      for (const origin of origins) grantedOrigins.delete(origin);
      for (const listener of removedListeners) {
        listener({ origins: [...origins] });
      }
    },
  };

  return fake;
};

export const createChromeFakeBrowser = (
  overrides: Parameters<typeof createFakeBrowser>[0] = {},
): FakeSiteAccessBrowser =>
  createFakeBrowser({
    ...overrides,
    gesturePolicy: "chrome",
    useChromeCallback: true,
  });

export const createFirefoxFakeBrowser = (
  overrides: Parameters<typeof createFakeBrowser>[0] = {},
): FakeSiteAccessBrowser =>
  createFakeBrowser({
    ...overrides,
    gesturePolicy: "firefox",
    useChromeCallback: false,
  });

export const GESTURE_BROWSERS = [
  ["Chrome", createChromeFakeBrowser],
  ["Firefox", createFirefoxFakeBrowser],
] as const;

export { ALL_SITE_ORIGINS, GESTURE_ERROR };
