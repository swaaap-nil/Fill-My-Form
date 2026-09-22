import { expect, test } from "./fixtures";

/**
 * Guards the fixtures themselves, for the specific properties nothing else
 * in the suite proves.
 *
 * Most fixture-shape drift is already caught more precisely by
 * `e2e/extraction.spec.ts`'s committed goldens (`simple`/`messy`/`dynamic`/
 * `controlled`) and its dedicated per-fixture assertions (`ibps-like.html`,
 * `supabase.html`, …), and by `e2e/verify.spec.ts` for `controlled.html`'s
 * write-technique behaviour — those test what the extractor and the fill
 * loop actually do with a fixture, which is the thing that matters. A test
 * here earns its place only when it proves something a golden or a
 * behavioural test cannot: that the fixture's own markup or client-side JS
 * still poses the specific problem it exists to pose, in a way an extracted
 * `FormField`'s shape wouldn't visibly change even if the fixture lost it.
 */

test("messy.html stays messy", async ({ page }) => {
  await page.goto("/messy.html");

  // The whole point of this fixture. If a label element appears here, the
  // fixture has stopped representing the problem — and a golden wouldn't
  // necessarily notice, since <label for> resolving to the same text as the
  // sibling-text fallback it replaced changes nothing in the extracted JSON.
  await expect(page.locator("label")).toHaveCount(0);

  const inputs = page.locator("#registration input");
  await expect(inputs.first()).toHaveAttribute("name", /^fld_\d+$/);

  // Meaning lives in adjacent text, not in any accessible relationship.
  await expect(page.getByText("10th Passing Year")).toBeVisible();
  await expect(page.getByText("दसवीं उत्तीर्ण वर्ष")).toBeVisible();

  // The bare "Year" that must resolve to `ambiguous` rather than a guess.
  await expect(page.getByText("of joining current employer")).toBeVisible();

  // Restricted data that must never be auto-filled.
  await expect(page.getByText("Aadhaar Number")).toBeVisible();
});

test("controlled.html: the custom combobox is only drivable by clicking an option", async ({
  page,
}) => {
  await page.goto("/controlled.html");

  // A `<div>`, not a native control — setting `.value` does nothing, and
  // nothing else in the suite proves the click-to-select affordance itself
  // still works (`e2e/extraction.spec.ts` only proves the widget's options
  // are visible to extraction, not that clicking one changes anything).
  await expect(page.locator("#combo-input")).toHaveAttribute(
    "role",
    "combobox",
  );
  await page.locator("#combo-input").click();
  await page.getByRole("option", { name: "India" }).click();
  await expect(page.locator("#combo-input")).toHaveText("India");
});

test("controlled.html: an invalid strict-format date is silently reverted", async ({
  page,
}) => {
  await page.goto("/controlled.html");

  // Nothing else in the suite drives this field with a bad format — only
  // with a value already known to be acceptable.
  const dateInput = page.locator("#strict-date");
  await dateInput.fill("15/06/1990");
  await dateInput.blur();
  await expect(dateInput).toHaveValue("15/06/1990");
  await dateInput.fill("not-a-date");
  await dateInput.blur();
  await expect(dateInput).toHaveValue("15/06/1990");
});

test("supabase.html: field names are still framework-generated, not human-readable", async ({
  page,
}) => {
  // The whole point of this fixture. `e2e/extraction.spec.ts`'s test proves
  // the extractor resolves these fields by label/concept regardless of the
  // name — which is exactly why it wouldn't notice the names themselves
  // becoming ordinary and no longer exercising that resilience case.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "localhost"
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await page.goto("/supabase.html", { waitUntil: "domcontentloaded" });

  const labelledControls = page.locator("#form label[for]");
  const generatedNames = await labelledControls.evaluateAll((labels) =>
    labels
      .map((label) =>
        label.ownerDocument
          .getElementById(label.getAttribute("for") ?? "")
          ?.getAttribute("name"),
      )
      .filter((name): name is string => !!name),
  );

  expect(generatedNames).toContain("_systemfield_name");
  expect(generatedNames).toContain("_systemfield_email");
  expect(generatedNames.some((name) => /^[0-9a-f-]{36}$/.test(name))).toBe(
    true,
  );
});
