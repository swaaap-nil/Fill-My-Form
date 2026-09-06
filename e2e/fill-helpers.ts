import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "./fill-fixtures";

/**
 * Shared setup for every spec that drives a real fill against the
 * `WXT_E2E=1` build (`build-e2e/chrome-mv3`) — originally written for
 * `e2e/fill.spec.ts`, now reused by `verify.spec.ts`, `dynamic-form.spec.ts`
 * and `resume.spec.ts`, all of which need the same grant-then-drive setup
 * against the same pre-authorised build.
 */

export const openPanel = async (
  context: BrowserContext,
  extensionId: string,
) => {
  const panelPage = await context.newPage();
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return panelPage;
};

/** Fills one onboarding field by its concept label and saves. */
export const seedAnswer = async (
  panelPage: Page,
  label: string,
  value: string,
) => {
  await panelPage.getByRole("button", { name: "My information" }).click();
  await panelPage.getByLabel(label, { exact: true }).fill(value);
  await panelPage.getByRole("button", { name: "Save" }).click();
  await expect(panelPage.getByTestId("saved-count")).toContainText("1 value");
  await panelPage.getByRole("button", { name: "Current page" }).click();
};

/**
 * Seeds several onboarding fields in one form session — `savedKeys` (backing
 * `saved-count`) accumulates across saves, so the count asserted at the end
 * is the total, not "1 value" per field the way `seedAnswer` checks it.
 */
export const seedAnswers = async (
  panelPage: Page,
  entries: readonly (readonly [label: string, value: string])[],
) => {
  await panelPage.getByRole("button", { name: "My information" }).click();
  for (const [label, value] of entries) {
    await panelPage.getByLabel(label, { exact: true }).fill(value);
    await panelPage.getByRole("button", { name: "Save" }).click();
  }
  await expect(panelPage.getByTestId("saved-count")).toContainText(
    `${entries.length} value`,
  );
  await panelPage.getByRole("button", { name: "Current page" }).click();
};

/**
 * Spike 2's fix, exercised: `registerContentScripts` only affects future
 * navigations, so a tab that was already open before access was granted
 * needs the direct `executeScript` injection `requestSiteAccess` performs
 * for whichever tab is currently active — hence `formPage.bringToFront()`
 * first.
 */
export const grantAccess = async (formPage: Page, panelPage: Page) => {
  await formPage.bringToFront();
  await panelPage
    .getByRole("button", { name: "Grant access to this site" })
    .click();
};

/**
 * Drives the Phase 2 agent loop (`AgentRunPanel`'s "Fill with agent") to
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
 */
export const driveAgentToCompletion = async (
  panelPage: Page,
  maxClicks = 15,
) => {
  await panelPage.getByRole("button", { name: "Scan this page" }).click();
  await panelPage.getByRole("button", { name: "Fill with agent" }).click();

  for (let i = 0; i < maxClicks; i++) {
    const confirmButton = panelPage.getByRole("button", {
      name: "Confirm",
      exact: true,
    });
    const done = panelPage.getByText("Run complete.");

    await expect(confirmButton.or(done)).toBeVisible();
    if (await done.isVisible()) return;
    await confirmButton.click({ timeout: 3000 }).catch(() => {});
  }

  throw new Error(
    "Agent run did not complete within the expected number of steps.",
  );
};
