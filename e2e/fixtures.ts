import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type BrowserContext,
  test as base,
  chromium,
  type Page,
} from "@playwright/test";
import { z } from "zod";

/**
 * Loads a built extension into a real Chromium.
 *
 * Extensions require a persistent context — there is no way to load one into
 * the ordinary `browser` fixture — so each test gets its own profile
 * directory and its own browser. That is why `workers: 1` and
 * `fullyParallel: false` in the config: these tests are not cheap, and there
 * are deliberately few of them.
 *
 * `channel: "chromium"` selects the full browser rather than the headless
 * shell; the shell does not support extensions.
 *
 * A factory, not a single fixture: `e2e/fill.spec.ts` needs the
 * `WXT_E2E=1` build (`build-e2e/chrome-mv3`, which carries a
 * `localhost:4173` host permission Playwright cannot click through) while
 * every other spec needs the ordinary release-shaped build
 * (`build/chrome-mv3`) so the "grants no site access" assertions stay
 * meaningful. One directory rebuilt twice would make one spec's build
 * clobber the other's.
 */
export const createExtensionFixtures = (extensionPath: string) =>
  base.extend<{
    context: BrowserContext;
    extensionId: string;
  }>({
    context: async ({ headless }, use) => {
      if (!existsSync(extensionPath)) {
        throw new Error(
          `No build at ${extensionPath}. Run \`bun test:e2e\`, which builds first.`,
        );
      }

      const profile = await mkdtemp(join(tmpdir(), "form-agent-e2e-"));

      const context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        headless,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      });

      await use(context);

      await context.close();
      await rm(profile, { recursive: true, force: true });
    },

    /**
     * Chrome assigns the id, so it has to be discovered. The background
     * service worker's URL carries it: chrome-extension://<id>/background.js
     */
    extensionId: async ({ context }, use) => {
      const worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent("serviceworker"));

      await use(new URL(worker.url()).host);
    },
  });

/**
 * Resolved from the working directory rather than `import.meta.dirname`:
 * Playwright transpiles specs to CommonJS, where `import.meta` is unavailable.
 */
const EXTENSION_PATH = resolve(process.cwd(), "build/chrome-mv3");

export const test = createExtensionFixtures(EXTENSION_PATH);
export const expect = test.expect;

/**
 * Reads the loaded extension's manifest as typed data.
 *
 * `ts-reset` makes `JSON.parse` return `unknown` — deliberately — so parse it
 * rather than casting. The schema is loose: it names only what the privacy
 * assertions depend on.
 */
export const manifestSchema = z.looseObject({
  permissions: z.array(z.string()).default([]),
  host_permissions: z.array(z.string()).optional(),
  optional_host_permissions: z.array(z.string()).default([]),
  content_scripts: z.array(z.unknown()).default([]),
  content_security_policy: z
    .looseObject({ extension_pages: z.string().optional() })
    .default({}),
  action: z.looseObject({ default_popup: z.string().optional() }).optional(),
  side_panel: z.looseObject({ default_path: z.string().optional() }).optional(),
});

export const readManifest = async (page: Page, extensionId: string) => {
  await page.goto(`chrome-extension://${extensionId}/manifest.json`);

  return manifestSchema.parse(
    JSON.parse(await page.locator("body").innerText()),
  );
};
