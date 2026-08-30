import { expect, test } from "./fixtures";

/**
 * Guards the fixtures themselves.
 *
 * These are the pages form detection will be built and measured against, so a
 * fixture that silently loses its awkwardness — someone "tidying up" messy.html
 * by adding labels — would quietly make future accuracy numbers meaningless.
 */

test("simple.html exposes every common control, all labelled", async ({
  page,
}) => {
  await page.goto("/simple.html");

  // Every control resolves by its accessible name: the easy case.
  await expect(page.getByLabel("First name")).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("10th Passing Year")).toBeVisible();
  await expect(page.getByLabel("Undergraduate degree")).toBeVisible();
  await expect(page.getByLabel("Cover note")).toBeVisible();
  await expect(page.getByLabel("Upload resume")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Email" })).toBeVisible();
});

test("messy.html stays messy", async ({ page }) => {
  await page.goto("/messy.html");

  // The whole point of this fixture. If a label element appears here, the
  // fixture has stopped representing the problem.
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

test("dynamic.html injects fields after load and between steps", async ({
  page,
}) => {
  await page.goto("/dynamic.html");

  // Not present in the served HTML — appears on a timer.
  await expect(page.getByLabel("How did you hear about us?")).toBeVisible();

  // Step two is hidden until step one validates.
  await expect(page.getByLabel("College / university")).toBeHidden();

  await page.getByLabel("Email address").fill("not-an-email");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByLabel("College / university")).toBeHidden();

  await page.getByLabel("Email address").fill("someone@example.com");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByLabel("College / university")).toBeVisible();
  await expect(page.getByLabel("Year of graduation")).toBeVisible();
});
