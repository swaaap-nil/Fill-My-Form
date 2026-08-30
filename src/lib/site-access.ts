import { browser } from "wxt/browser";

/**
 * Per-site access, granted by the user, one origin at a time.
 *
 * The extension ships with no host permissions (see `wxt.config.ts`). Nothing
 * runs on a page until the user grants access to that page's origin, at which
 * point the content script is registered for that origin only.
 *
 * This is the runtime half of the privacy boundary described in
 * docs/privacy.md; the manifest is the static half.
 */

const CONTENT_SCRIPT_ID = "form-agent-content";

/** `https://example.com/path?q=1` -> `https://example.com/*` */
export const toOriginPattern = (url: string): string =>
  `${new URL(url).origin}/*`;

export const hasSiteAccess = (url: string): Promise<boolean> =>
  browser.permissions.contains({ origins: [toOriginPattern(url)] });

/**
 * Must be called from a user gesture — Chrome rejects `permissions.request`
 * otherwise. Returns false if the user declines; that is a normal outcome and
 * the caller should degrade rather than retry.
 */
export const requestSiteAccess = async (url: string): Promise<boolean> => {
  const origin = toOriginPattern(url);

  const granted = await browser.permissions.request({ origins: [origin] });
  if (!granted) return false;

  await registerForOrigin(origin);
  return true;
};

export const revokeSiteAccess = async (url: string): Promise<void> => {
  const origin = toOriginPattern(url);

  await browser.scripting
    .unregisterContentScripts({ ids: [scriptIdFor(origin)] })
    .catch(() => {
      // Not registered. Revoking is idempotent by design.
    });
  await browser.permissions.remove({ origins: [origin] });
};

const scriptIdFor = (origin: string) =>
  `${CONTENT_SCRIPT_ID}:${origin.replace(/[^a-zA-Z0-9]/g, "_")}`;

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
      js: ["content-scripts/content.js"],
      css: ["content-scripts/content.css"],
      runAt: "document_idle",
    },
  ]);
};

/**
 * Re-registers scripts for every origin the user has already granted. Call on
 * startup: runtime registrations do not survive a browser restart, but the
 * permission grants do.
 */
export const restoreGrantedSites = async (): Promise<number> => {
  const { origins = [] } = await browser.permissions.getAll();

  await Promise.all(origins.map(registerForOrigin));
  return origins.length;
};
