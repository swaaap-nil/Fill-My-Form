/**
 * Captures store-listing screenshots at 1280x800 against the built
 * extension and the local fixture site.
 *
 * Uses the `build-e2e/chrome-mv3` build (`bun run build:chrome:e2e`)
 * because it has `localhost:4173` pre-granted, which lets the scan button
 * exercise the post-grant flow without a native permission bubble in the
 * way — Playwright cannot drive that bubble, so the permission part is
 * represented by the granted-origin list rather than the OS-level dialog.
 * Note this limitation in the actual store listing if the native bubble
 * matters to a reviewer.
 *
 * Run with the fixture site already up (`bun dev:site` in another
 * terminal) or let this script assume `bun test:e2e`'s webServer isn't
 * running and start one itself would be overkill for a one-off capture —
 * simplest to just require it running.
 *
 * Output: docs/store/screenshots/*.png — review before use. A reviewer
 * looks at these images; this script is a starting point, not a
 * substitute for a human confirming they read cleanly at listing size.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const EXTENSION_PATH = resolve(process.cwd(), "build-e2e/chrome-mv3");
const OUT_DIR = resolve(process.cwd(), "docs/store/screenshots");
const VIEWPORT = { width: 1280, height: 800 };

async function main() {
  if (!existsSync(EXTENSION_PATH)) {
    console.error(
      `No build at ${EXTENSION_PATH}. Run \`bun run build:chrome:e2e\` first.`,
    );
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const profile = await mkdtemp(join(tmpdir(), "form-agent-screenshots-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    viewport: VIEWPORT,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;

    const formPage = await context.newPage();
    await formPage.goto("http://localhost:4173/simple.html");

    const panelPage = await context.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.setViewportSize(VIEWPORT);

    // Seed a couple of answers via onboarding so the fill screenshot has
    // something real to show.
    await panelPage.getByRole("button", { name: "My information" }).click();
    await panelPage.getByLabel("First name", { exact: true }).fill("Ananya");
    await panelPage
      .getByLabel("Email address", { exact: true })
      .fill("ananya@example.com");
    await panelPage
      .getByLabel("National ID number (Aadhaar)", { exact: true })
      .fill("1234 5678 9012");
    await panelPage.getByTestId("saved-count").waitFor({ state: "visible" });
    await panelPage
      .getByTestId("saved-count")
      .waitFor({ state: "attached", timeout: 5000 });
    await panelPage.waitForFunction(() =>
      document
        .querySelector('[data-testid="saved-count"]')
        ?.textContent?.includes("3 values"),
    );
    await panelPage.evaluate(() => window.scrollTo(0, 0));

    await panelPage.screenshot({
      path: join(OUT_DIR, "1-onboarding.png"),
    });

    await panelPage.getByRole("button", { name: "Fill this page" }).click();
    await formPage.bringToFront();
    await panelPage.getByRole("button", { name: "Scan this page" }).click();
    await panelPage.waitForTimeout(300);

    await panelPage.screenshot({
      path: join(OUT_DIR, "2-grant.png"),
    });

    // messy.html, not simple.html: it has a field that resolves to the
    // restricted Aadhaar concept, which is the state most worth showing a
    // reviewer alongside an ordinary pending one.
    await formPage.goto("http://localhost:4173/messy.html");
    await formPage.bringToFront();
    await panelPage.getByRole("button", { name: "Scan this page" }).click();
    await panelPage.waitForTimeout(500);

    await panelPage.getByText("documents.national_id").scrollIntoViewIfNeeded();
    await panelPage.waitForTimeout(200);

    await panelPage.screenshot({
      path: join(OUT_DIR, "3-confirmation-review.png"),
    });

    console.log(`Saved 3 screenshots to ${OUT_DIR}`);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
}

main();
