/**
 * Live-document access flag. `unregisterContentScripts` only stops future
 * navigations; an already-injected content script must refuse extract/fill
 * after the user turns access off. Stored on the document element so a later
 * `executeScript` injection (a new scan after re-grant) can restore access
 * for handlers registered by the first injection.
 */

export const PAGE_ACCESS_REVOKED_ATTR = "data-fill-my-form-access-revoked";

export interface PageAccessRoot {
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export const createPageAccessSession = (root?: PageAccessRoot) => {
  let revoked = false;

  return {
    revoke(): void {
      revoked = true;
      root?.setAttribute(PAGE_ACCESS_REVOKED_ATTR, "");
    },
    restore(): void {
      revoked = false;
      root?.removeAttribute(PAGE_ACCESS_REVOKED_ATTR);
    },
    isRevoked(): boolean {
      return root ? root.hasAttribute(PAGE_ACCESS_REVOKED_ATTR) : revoked;
    },
  };
};

export type PageAccessSession = ReturnType<typeof createPageAccessSession>;
