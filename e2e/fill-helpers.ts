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
  await panelPage.getByRole("button", { name: "Current page" }).click();
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
  await panelPage.getByRole("button", { name: "Current page" }).click();
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
  const scanButton = panelPage.getByRole("button", { name: "Scan this page" });
  const grantedAccess = panelPage.getByText("Access is on for");

  if (await grantedAccess.isVisible({ timeout: 1000 }).catch(() => false)) {
    await formPage.reload({ waitUntil: "domcontentloaded" });
  } else if (await scanButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await scanButton.click();
  }
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
 */
export const driveAgentToCompletion = async (
  panelPage: Page,
  maxClicks = 15,
) => {
  await panelPage.getByRole("button", { name: "Scan this page" }).click();
  await panelPage.getByRole("button", { name: "Answer now" }).click();

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
