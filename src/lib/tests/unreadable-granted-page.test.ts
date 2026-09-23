import { describe, expect, it } from "bun:test";
import { createSiteAccess } from "~/lib/site-access";
import { createChromeFakeBrowser } from "./fake-site-access-browser";

/**
 * Diagnostic for: "Access is on for All websites" vanishes after Scan and
 * returns on panel refresh.
 *
 * Some pages are permission-granted but never script-injectable (browser
 * stores, PDF viewers, error pages). The browser keeps reporting the
 * permission as held, while injection is refused. The panel derives the
 * "Access is on" line from `activeTabGranted`, and `scanGrantedTab` sets
 * that flag to false when the read fails, even though the permission itself
 * never changed. A refresh recomputes it from `permissions.contains`, so the
 * line comes back.
 *
 * These tests pin the two facts that make the panel's `setActiveTabGranted(false)`
 * wrong: the permission stays held, and the failed injection is now reported
 * to callers.
 */

const UNINJECTABLE_URL = "https://store.example/detail/some-extension/abc";

const browserWithRefusedInjection = () => {
  const fake = createChromeFakeBrowser({
    grantedOrigins: new Set(["https://*/*", "http://*/*"]),
  });
  fake.scripting.executeScript = async () => {
    throw new Error("The extensions gallery cannot be scripted.");
  };
  return fake;
};

describe("granted but unreadable page", () => {
  it("keeps reporting access as held after injection is refused", async () => {
    const access = createSiteAccess(browserWithRefusedInjection());

    expect(await access.hasSiteAccess(UNINJECTABLE_URL)).toBe(true);
    await access.syncScriptsForGrantedAccess(UNINJECTABLE_URL, 1);
    expect(await access.hasSiteAccess(UNINJECTABLE_URL)).toBe(true);
    expect(await access.hasAllSiteAccess()).toBe(true);
    expect(await access.listGrantedOrigins()).toContain("https://*/*");
  });

  it("reports refused injection without throwing", async () => {
    const access = createSiteAccess(browserWithRefusedInjection());

    await expect(
      access.syncScriptsForGrantedAccess(UNINJECTABLE_URL, 1),
    ).resolves.toEqual({ injected: false });
  });

  it("reports successful injection", async () => {
    const access = createSiteAccess(
      createChromeFakeBrowser({
        grantedOrigins: new Set(["https://*/*"]),
      }),
    );

    await expect(
      access.syncScriptsForGrantedAccess(UNINJECTABLE_URL, 1),
    ).resolves.toEqual({ injected: true });
  });
});
