import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "./fill-fixtures";

/**
 * Shared setup for every spec that drives a real fill against the
 * `WXT_E2E=1` build (`build-e2e/chrome-mv3`) — originally written for
 * `e2e/fill.spec.ts`, now reused by `verify.spec.ts`, `dynamic-form.spec.ts`
 * and `resume.spec.ts`, all of which need the same grant-then-drive setup
 * against the same pre-authorised build.
 *
 * Opening the panel declines the first-run all-sites gate. Playwright cannot
 * click Chrome's native permission bubble, so tests stay on the one-origin
 * grant path these specs already cover.
 */

const fillScanButton = (panelPage: Page) =>
  panelPage.getByRole("button", {
    name: /^(Scan this page|Rescan page|Scan again)$/,
  });

/**
 * Playwright cannot click Chrome's native all-sites permission bubble, so
 * tests decline the first-run gate and keep using the one-origin grant path
 * (`grantAccess` / Scan this page).
 */
export const dismissFirstRunAccessGate = async (panelPage: Page) => {
  const gate = panelPage.getByTestId("first-run-access-gate");
  const scanButton = fillScanButton(panelPage);

  await Promise.race([
    gate.waitFor({ state: "visible" }),
    scanButton.waitFor({ state: "visible" }),
  ]);

  if (await gate.isVisible()) {
    await gate.getByRole("button", { name: "Not now" }).click();
    await expect(gate).toBeHidden();
  }

  await expect(scanButton).toBeVisible();
};

export const openPanel = async (
  context: BrowserContext,
  extensionId: string,
) => {
  const panelPage = await context.newPage();
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await dismissFirstRunAccessGate(panelPage);
  return panelPage;
};

const waitForSavedCount = async (panelPage: Page, count: number) => {
  await expect(panelPage.getByTestId("saved-count")).toContainText(
    `${count} value`,
  );
};

/** Fills one onboarding field by its concept label and waits for autosave. */
export const seedAnswer = async (
  panelPage: Page,
  label: string,
  value: string,
) => {
  await panelPage.getByRole("button", { name: "My information" }).click();
  await panelPage.getByLabel(label, { exact: true }).fill(value);
  await waitForSavedCount(panelPage, 1);
  await panelPage.getByRole("button", { name: "Back to home" }).click();
};

/**
 * Seeds several onboarding fields in one form session. `savedKeys` (backing
 * `saved-count`) accumulates across autosaves, so each assertion is the total.
 */
export const seedAnswers = async (
  panelPage: Page,
  entries: readonly (readonly [label: string, value: string])[],
) => {
  await panelPage.getByRole("button", { name: "My information" }).click();
  for (const [index, [label, value]] of entries.entries()) {
    const input = panelPage.getByLabel(label, { exact: true });
    await input.fill(value);
    await expect(input).toHaveValue(value);
    await waitForSavedCount(panelPage, index + 1);
  }
  await panelPage.getByRole("button", { name: "Back to home" }).click();
};

export const seedFile = async (
  panelPage: Page,
  label: string,
  path: string,
  statusTestId?: string,
) => {
  await panelPage.getByRole("button", { name: "My information" }).click();
  await panelPage.getByLabel(label, { exact: true }).setInputFiles(path);
  if (statusTestId) {
    await expect(panelPage.getByTestId(statusTestId)).toHaveAttribute(
      "aria-label",
      "Saved",
    );
  }
  await waitForSavedCount(panelPage, 1);
  await panelPage.getByRole("button", { name: "Back to home" }).click();
};

/**
 * Spike 2's fix, exercised: `registerContentScripts` only affects future
 * navigations, so a tab that was already open before access was granted
 * needs the direct `executeScript` injection `requestSiteAccess` performs
 * for whichever tab is currently active — hence `formPage.bringToFront()`
 * first.
 *
 * Opening the panel makes *that* tab active, so wait for the form tab's
 * grant chrome after focusing it. Per-site access now reads "This site
 * only:" rather than "Access is on for". Do not click Scan here — that
 * would fill the page and leave later tests looking for an idle scan
 * button.
 */
export const grantAccess = async (formPage: Page, panelPage: Page) => {
  await formPage.bringToFront();
  await expect(
    panelPage.getByText(/This site only:|Access is on for/),
  ).toBeVisible({ timeout: 10_000 });
  await formPage.reload({ waitUntil: "domcontentloaded" });
};

export const clickScan = async (panelPage: Page) => {
  await fillScanButton(panelPage).click();
};

export const openProposalDetails = async (panelPage: Page) => {
  await panelPage.getByTestId("answers-summary").click();
};

/**
 * Drives the Phase 2 agent loop (`AgentRunPanel`'s "Answer now") to
 * completion by repeatedly clicking Confirm.
 *
 * The background answers a review confirmation synchronously and often
 * finishes the whole run in the same tick — faster than Playwright's own
 * actionability re-check after locating the button, so the button can be
 * gone by the time the click would land. Without a bounded `timeout` here,
 * `.click()`'s internal retry loop for a vanished target keeps going until
 * the *test's* timeout, which reads as a hang rather than what it is: the
 * run already finished. A short click timeout, swallowed, lets the next
 * loop iteration's check for "Run complete." see what actually happened.
 *
 * A per-tab scan snapshot (or a scan that already ran) can leave "Answer
 * now" on screen. Clicking Rescan in that state races the next assertion,
 * so start the loop from the proposals that are already there.
 */
export const driveAgentToCompletion = async (
  panelPage: Page,
  maxClicks = 15,
) => {
  const answerNow = panelPage.getByRole("button", { name: "Answer now" });
  if (!(await answerNow.isVisible({ timeout: 1000 }).catch(() => false))) {
    await clickScan(panelPage);
  }
  await answerNow.click();

  for (let i = 0; i < maxClicks; i++) {
    const confirmButton = panelPage
      .getByRole("button", {
        name: "Confirm",
        exact: true,
      })
      .first();
    const done = panelPage.getByText("Run complete.");

    if (await done.isVisible()) return;
    const nextState = await Promise.any([
      done.waitFor({ state: "visible", timeout: 5000 }).then(() => "done"),
      confirmButton
        .waitFor({ state: "visible", timeout: 5000 })
        .then(() => "confirm"),
    ]);
    if (nextState === "done") return;
    await confirmButton.click({ timeout: 3000 }).catch(() => {});
  }

  throw new Error(
    "Agent run did not complete within the expected number of steps.",
  );
};
