import { expect, readManifest, test } from "./fixtures";

/**
 * The failure this guards against: a build that produces output which does not
 * actually load. Unit tests cannot catch that — they never touch a manifest,
 * a service worker or a bundled entrypoint.
 */

test("the background service worker boots", async ({ context }) => {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));

  expect(worker.url()).toContain("background.js");
});

test("the manifest grants no site access at install time", async ({
  page,
  extensionId,
}) => {
  const manifest = await readManifest(page, extensionId);

  // The privacy claim, asserted against the artefact Chrome actually loaded
  // rather than against the source. See docs/privacy.md.
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toHaveLength(0);
  expect(manifest.permissions).not.toContain("<all_urls>");
  expect(manifest.optional_host_permissions).toContain("https://*/*");
});

test("the content security policy forbids eval and remote script", async ({
  page,
  extensionId,
}) => {
  const manifest = await readManifest(page, extensionId);

  const csp = manifest.content_security_policy.extension_pages ?? "";
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-eval");
  expect(csp).not.toContain("unsafe-inline");
});

/**
 * Playwright cannot open the real side panel: `chrome.sidePanel.open()` needs
 * a user gesture on the toolbar icon, which is browser chrome rather than page
 * content. Navigating to the page directly renders the same React tree, which
 * is what we care about here.
 */
for (const [name, path] of Object.entries({
  "side panel": "sidepanel.html",
  popup: "popup.html",
  options: "options.html",
})) {
  test(`the ${name} renders without console errors`, async ({
    page,
    extensionId,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`chrome-extension://${extensionId}/${path}`);

    // Renders something, and specifically renders OUR copy rather than the
    // starter's — this would have caught the un-rebranded build.
    await expect(page.getByRole("contentinfo")).toContainText(
      "stays on this device",
    );
    expect(errors).toEqual([]);
  });
}

test("boots with no configuration at all", async ({ page, extensionId }) => {
  // The extension is local-first: an empty .env must not stop it rendering.
  // Regression guard for env vars ever becoming required again.
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(page.locator("#root")).not.toBeEmpty();
});
