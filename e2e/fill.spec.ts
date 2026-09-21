import type { BrowserContext } from "@playwright/test";
import { expect, test } from "./fill-fixtures";
import {
  clickScan,
  grantAccess,
  openPanel,
  openProposalDetails,
  seedAnswer,
  seedAnswers,
} from "./fill-helpers";

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

test("first run: Not now dismisses the all-sites gate and shows the fill panel", async ({
  context,
  extensionId,
}) => {
  const panelPage = await context.newPage();
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const gate = panelPage.getByTestId("first-run-access-gate");
  await expect(gate).toBeVisible();
  await expect(
    panelPage.getByRole("heading", { name: "Detect forms automatically" }),
  ).toBeVisible();
  await expect(
    panelPage.getByRole("button", { name: "Allow on all websites" }),
  ).toBeVisible();

  await panelPage.getByRole("button", { name: "My information" }).click();
  await expect(
    panelPage.getByRole("button", { name: "Back to home" }),
  ).toBeVisible();
  await panelPage.getByRole("button", { name: "Back to home" }).click();
  await expect(gate).toBeVisible();

  await gate.getByRole("button", { name: "Not now" }).click();
  await expect(gate).toBeHidden();
  await expect(
    panelPage.getByRole("button", { name: "Scan this page" }),
  ).toBeVisible();

  await panelPage.reload();
  await expect(gate).toBeHidden();
  await expect(
    panelPage.getByRole("button", { name: "Scan this page" }),
  ).toBeVisible();
});

test("grant: clicking the panel's grant button registers the content script", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await grantAccess(formPage, panelPage);

  const ids = await getRegisteredScriptIds(context);
  expect(
    ids.some(
      (id) => id.startsWith("form-agent-content:") && !id.includes("all_sites"),
    ),
  ).toBe(true);
});

test("Turn off unregisters the origin content script", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await grantAccess(formPage, panelPage);

  await expect(
    panelPage.getByRole("button", { name: "Turn off" }),
  ).toBeVisible();
  await panelPage.getByRole("button", { name: "Turn off" }).click();

  // WXT_E2E pre-grants localhost as a required host_permission, which
  // Chrome cannot remove. Unregistering still stops future injection;
  // ungranted 127.0.0.1 covers "no grant, no run" below.
  await expect
    .poll(async () => {
      const ids = await getRegisteredScriptIds(context);
      return ids.some(
        (id) =>
          id.startsWith("form-agent-content:") && !id.includes("all_sites"),
      );
    })
    .toBe(false);

  await formPage.reload({ waitUntil: "domcontentloaded" });
  await expect(formPage.locator("form-agent-ui")).toHaveCount(0);
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
  await clickScan(panelPage);

  await expect(panelPage.getByText("1 answer detected")).toBeVisible();
  await expect(panelPage.getByText(/^Last scanned .+/)).toBeVisible();
  await expect(
    panelPage.getByRole("button", { name: "Rescan page" }),
  ).toBeVisible();
  await openProposalDetails(panelPage);
  await expect(panelPage.getByText("contact.email")).toBeVisible();

  // The assertion that proves policy is on the path: proposing is not filling.
  await expect(formPage.getByLabel("Email address")).toHaveValue("");
  await expect(formPage.getByLabel("First name")).toHaveValue("");
});

test("empty scan: shows localized message instead of Answer now and never again", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/");

  const panelPage = await openPanel(context, extensionId);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await clickScan(panelPage);

  await expect(
    panelPage.getByRole("heading", {
      name: "Sorry, you're on your own on this one.",
    }),
  ).toBeVisible();
  await expect(panelPage.getByTestId("scan-no-fields-found")).toContainText(
    "No fillable fields on this page.",
  );
  await expect(
    panelPage.getByRole("button", { name: "Answer now and never again" }),
  ).toBeHidden();
});

test("summary cards: hides answers summary when no answers are detected", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await clickScan(panelPage);

  await expect(panelPage.getByTestId("answers-summary-card")).toBeHidden();
  await expect(
    panelPage.getByTestId("known-fields-summary-card"),
  ).toBeVisible();
  await expect(
    panelPage.getByTestId("upload-requirements-summary-card"),
  ).toBeVisible();
});

test("summary cards: upload requirements stay collapsed until opened", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await clickScan(panelPage);

  const uploadCard = panelPage.getByTestId("upload-requirements-summary-card");
  await expect(uploadCard).toBeVisible();
  await expect(
    uploadCard.getByText("1 upload requirement detected"),
  ).toBeVisible();
  await expect(
    panelPage.getByRole("button", {
      name: "Upload Files and forget about them",
    }),
  ).toBeVisible();
  await expect(uploadCard.locator('input[type="file"]')).toHaveCount(0);

  await uploadCard.click({ position: { x: 8, y: 8 } });
  await expect(
    panelPage.getByText(
      "We know this is documents.resume, but you haven't prepared a copy for it yet — choose a file below.",
    ),
  ).toBeVisible();
  await expect(
    panelPage.getByText("Upload resume PDF, max 2 MB"),
  ).toBeVisible();
  await expect(panelPage.getByText("Browse or drag a file here")).toBeVisible();
  await expect(panelPage.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(uploadCard).toBeHidden();

  await panelPage.getByRole("button", { name: "Back" }).click();
  await expect(uploadCard).toBeVisible();
  await expect(uploadCard.locator('input[type="file"]')).toHaveCount(0);

  await panelPage
    .getByRole("button", { name: "Upload Files and forget about them" })
    .click();
  await expect(panelPage.getByText("Browse or drag a file here")).toBeVisible();
  await panelPage.getByRole("button", { name: "Back" }).click();

  await expect(uploadCard).toBeVisible();
  await expect(
    panelPage.getByTestId("known-fields-summary-card"),
  ).toBeVisible();
});

test("summary cards: card surface opens details without stealing fill clicks", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await seedAnswer(panelPage, "Email address", "ananya@example.com");
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await clickScan(panelPage);
  await expect(panelPage.getByText("1 answer detected")).toBeVisible();

  await panelPage
    .getByTestId("answers-summary-card")
    .click({ position: { x: 8, y: 8 } });
  await expect(panelPage.getByText("contact.email")).toBeVisible();
  await panelPage.getByRole("button", { name: "Back" }).click();

  await panelPage
    .getByTestId("known-fields-summary-card")
    .click({ position: { x: 8, y: 8 } });
  await expect(panelPage.getByText("identity.first_name")).toBeVisible();
  await panelPage.getByRole("button", { name: "Back" }).click();

  await panelPage
    .getByTestId("upload-requirements-summary-card")
    .click({ position: { x: 8, y: 8 } });
  await expect(panelPage.getByText("Browse or drag a file here")).toBeVisible();
  await panelPage.getByRole("button", { name: "Back" }).click();

  await panelPage.getByRole("button", { name: "Fill My Form 😡" }).click();
  await expect(panelPage.getByText("1 answer filled")).toBeVisible();
  await expect(panelPage.getByRole("button", { name: "Back" })).toBeHidden();
  await expect(formPage.getByLabel("Email address")).toHaveValue(
    "ananya@example.com",
  );
});

test("known fields: autosaving a value from the card turns it into an answer", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await clickScan(panelPage);

  await panelPage
    .getByTestId("known-fields-summary-card")
    .click({ position: { x: 8, y: 8 } });
  await expect(
    panelPage.getByText(
      "We know this is identity.first_name, but you haven't saved a value for it yet — enter it below.",
    ),
  ).toBeVisible();
  await expect(panelPage.getByRole("button", { name: "Save" })).toBeHidden();

  const firstName = panelPage.getByLabel("First name", { exact: true });
  const status = panelPage.getByTestId("autosave-status-identity.first_name");
  await firstName.fill("Ananya");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute(
    "aria-label",
    /Waiting to save|Saving|Saved/,
  );
  await expect(status).toHaveAttribute("aria-label", "Saved");

  await panelPage.getByRole("button", { name: "Back" }).click();
  await expect(panelPage.getByText("1 answer detected")).toBeVisible();
  await panelPage
    .getByTestId("answers-summary-card")
    .click({ position: { x: 8, y: 8 } });
  await expect(panelPage.getByText("identity.first_name")).toBeVisible();
  await expect(panelPage.getByText("Ananya")).toBeVisible();
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
  await clickScan(panelPage);
  await openProposalDetails(panelPage);

  await panelPage
    .getByRole("button", { name: "Confirm", exact: true })
    .first()
    .click();

  await expect(formPage.getByLabel("Email address")).toHaveValue(
    "ananya@example.com",
  );
});

test("closed-vocabulary fields: a stored value resolves to the field's own option and gets written", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/category-select.html");

  const panelPage = await openPanel(context, extensionId);
  // Neither stored value equals any option's `value` attribute verbatim:
  // "Indian" only matches India's `value="IN"` through the nationality
  // concept's `valueAliases` demonym table, and "OBC" only matches
  // OBC-NCL's `value="2"` through containment on the visible label — see
  // `~/core/matching/resolve-option`.
  await seedAnswers(panelPage, [
    ["Nationality", "Indian"],
    ["Reservation category", "OBC"],
  ]);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await clickScan(panelPage);
  await openProposalDetails(panelPage);
  for (const confirmButton of await panelPage
    .getByRole("button", { name: "Confirm", exact: true })
    .all()) {
    await confirmButton.click();
  }

  await expect(formPage.getByLabel("Nationality")).toHaveValue("IN");
  await expect(formPage.getByRole("radio", { name: "OBC-NCL" })).toBeChecked();
  await expect(formPage.getByRole("radio", { name: "GEN" })).not.toBeChecked();
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
  await clickScan(panelPage);
  await expect(panelPage.getByText("1 answer detected")).toBeVisible();
  await panelPage.getByRole("button", { name: "Fill My Form 😡" }).click();
  await expect(formPage.getByText("1 field updated").first()).toBeVisible();
  await expect(panelPage.getByText("1 answer filled")).toBeVisible();
  await expect(panelPage.getByText("Filled from last scan")).toBeVisible();
  await expect(
    panelPage.getByRole("button", { name: "Scan again" }),
  ).toBeVisible();

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
  await clickScan(panelPage);
  await expect(panelPage.getByText("1 answer detected")).toBeVisible();
  await openProposalDetails(panelPage);

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
  await clickScan(panelPage);
  await openProposalDetails(panelPage);

  await expect(panelPage.getByText("identity.first_name")).toBeVisible();
  await expect(panelPage.getByText(/source: user_provided/i)).toBeVisible();
});

test("privacy: fixture fills make no outbound network requests", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await seedAnswers(panelPage, [
    ["First name", "Ananya"],
    ["Last name", "Rao"],
    ["Email address", "ananya@example.com"],
  ]);
  await grantAccess(formPage, panelPage);

  const externalRequests: string[] = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    const isFixtureServer =
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.port === "4173";

    if (isHttp && !isFixtureServer) {
      externalRequests.push(request.url());
    }
  });

  await formPage.bringToFront();
  await clickScan(panelPage);
  await expect(panelPage.getByText("3 answers detected")).toBeVisible();
  await panelPage.getByRole("button", { name: "Fill My Form 😡" }).click();
  await expect(panelPage.getByText("3 answers filled")).toBeVisible();
  await expect(panelPage.getByText("Filled from last scan")).toBeVisible();
  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Scan again" }).click();
  await expect(panelPage.getByText(/^Last scanned .+/)).toBeVisible();
  await expect(panelPage.getByText("3 answers detected")).toBeVisible();
  await expect(panelPage.getByText("3 answers filled")).toBeHidden();

  expect(externalRequests).toEqual([]);
});
