import type { BrowserContext } from "@playwright/test";
import { expect, test } from "./fill-fixtures";
import { grantAccess, openPanel, seedAnswer } from "./fill-helpers";

/**
 * The first real fill, end to end, against the `WXT_E2E=1` build
 * (`build-e2e/chrome-mv3`) — the one build with `localhost:4173`
 * pre-granted in `host_permissions`, because Playwright cannot click
 * Chrome's native permission bubble. `scripts/check-release-manifest.ts`
 * fails any *release* build carrying that, so this can never leak out; see
 * `wxt.config.ts`'s `build:manifestGenerated` hook.
 *
 * The side panel is driven as a plain tab (`chrome-extension://<id>
 * /sidepanel.html`), per the same constraint `e2e/extension.spec.ts`
 * documents: Playwright cannot open the real side panel. That makes
 * "the active tab" ambiguous — the panel tab would otherwise be it — so
 * every action that depends on `chrome.tabs.query({active:true})`
 * resolving to the *form* tab is preceded by `formPage.bringToFront()`.
 * Playwright can still drive `panelPage`'s elements afterwards regardless
 * of which tab is visually frontmost.
 *
 * `openPanel`/`seedAnswer`/`grantAccess` live in `./fill-helpers` now,
 * shared with `verify.spec.ts`, `dynamic-form.spec.ts` and `resume.spec.ts`.
 */

/** Minimal shape of what the worker-side `evaluate` callback needs. */
interface ScriptingGlobal {
  readonly chrome: {
    readonly scripting: {
      getRegisteredContentScripts(): Promise<readonly { id: string }[]>;
    };
  };
}

const getRegisteredScriptIds = async (
  context: BrowserContext,
): Promise<string[]> => {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  return worker.evaluate(async () => {
    const scripts = await (
      globalThis as unknown as ScriptingGlobal
    ).chrome.scripting.getRegisteredContentScripts();
    return scripts.map((s) => s.id);
  });
};

test("grant: clicking the panel's grant button registers the content script", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await grantAccess(formPage, panelPage);

  const ids = await getRegisteredScriptIds(context);
  expect(ids.some((id) => id.includes("localhost_4173"))).toBe(true);
});

test("propose: scanning shows every field's proposal and fills nothing", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await seedAnswer(panelPage, "Email address", "ananya@example.com");
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Scan this page" }).click();

  // 12 in-scope controls on simple.html (csrf is never a candidate).
  const cards = panelPage.locator('[class*="rounded-md"][class*="border"]');
  await expect(cards.first()).toBeVisible();

  // The assertion that proves policy is on the path: proposing is not filling.
  await expect(formPage.getByLabel("Email address")).toHaveValue("");
  await expect(formPage.getByLabel("First name")).toHaveValue("");
});

test("confirm: confirming a proposal writes the value into the page", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await seedAnswer(panelPage, "Email address", "ananya@example.com");
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Scan this page" }).click();

  await panelPage
    .getByRole("button", { name: "Confirm", exact: true })
    .first()
    .click();

  await expect(formPage.getByLabel("Email address")).toHaveValue(
    "ananya@example.com",
  );
});

test("untouched: the csrf field and the terms checkbox are never filled", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await seedAnswer(panelPage, "Email address", "ananya@example.com");
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Scan this page" }).click();
  const confirmButtons = panelPage.getByRole("button", {
    name: "Confirm",
    exact: true,
  });
  const count = await confirmButtons.count();
  for (let i = 0; i < count; i++) {
    await confirmButtons.nth(i).click();
  }

  // csrf is a hidden field: 1a's extractor excludes it structurally, so it
  // was never a candidate and could not have been proposed, let alone filled.
  await expect(formPage.locator('input[name="csrf"]')).toHaveValue("fixture");
  // The terms checkbox resolves to no concept — it must stay unchecked.
  await expect(
    formPage.getByRole("checkbox", { name: /accept the terms/i }),
  ).not.toBeChecked();
});

test("restricted: the Aadhaar field is reported as restricted and never auto-filled", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/messy.html");

  const panelPage = await openPanel(context, extensionId);
  await seedAnswer(panelPage, "National ID number (Aadhaar)", "1234 5678 9012");
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Scan this page" }).click();

  // Reported distinctly, not merely "unknown": the restricted card names
  // the concept and requires its own confirm click.
  await expect(panelPage.getByText("documents.national_id")).toBeVisible();
  await expect(
    panelPage.getByText(/sensitive\. confirm only if you mean to fill/i),
  ).toBeVisible();

  // Aadhaar's DOM name in messy.html is fld_11 — confirm it is untouched.
  await expect(formPage.locator('input[name="fld_11"]')).toHaveValue("");
});

test("no grant, no run: an ungranted origin never receives the content script", async ({
  context,
}) => {
  // Same server, a different origin string (127.0.0.1 vs localhost) — not
  // covered by the WXT_E2E build's localhost:4173 grant. Stays fully local,
  // per the rule that automated tests never depend on a third-party site.
  const formPage = await context.newPage();
  await formPage.goto("http://127.0.0.1:4173/simple.html");
  await formPage.waitForLoadState("networkidle");

  await expect(formPage.locator("form-agent-ui")).toHaveCount(0);
});

test("onboarding round trip: a value typed in onboarding appears as a proposal with provenance", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await seedAnswer(panelPage, "First name", "Ananya");
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Scan this page" }).click();

  await expect(panelPage.getByText("identity.first_name")).toBeVisible();
  await expect(panelPage.getByText(/source: user_provided/i)).toBeVisible();
});
