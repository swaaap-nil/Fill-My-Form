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

test("ibps-like.html exposes the scanned photograph upload shape", async ({
  page,
}) => {
  await page.goto("/ibps-like.html");

  const photographRow = page
    .locator(".file-row")
    .filter({ hasText: "Scanned Photograph of the Candidate:" });
  await expect(
    photographRow.getByText("Scanned Photograph of the Candidate:"),
  ).toBeVisible();
  await expect(page.locator("#photographUpload")).toHaveAttribute(
    "type",
    "file",
  );
  await expect(photographRow.getByText("Choose file")).toBeVisible();
  await expect(
    photographRow.getByRole("button", { name: "Browse" }),
  ).toBeVisible();

  const signatureRow = page
    .locator(".file-row")
    .filter({ hasText: "Scanned Signature of the Candidate:" });
  await expect(
    signatureRow.getByText("Scanned Signature of the Candidate:"),
  ).toBeVisible();
  await expect(page.locator("#signatureUpload")).toHaveAttribute(
    "type",
    "file",
  );
  await expect(signatureRow.getByText("Choose file")).toBeVisible();
  await expect(
    signatureRow.getByRole("button", { name: "Browse" }),
  ).toBeVisible();
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

test("controlled.html keeps its four hard-to-fill controls", async ({
  page,
}) => {
  await page.goto("/controlled.html");

  // 1. React-controlled: a plain value write must be visibly undone by the
  // page's own input handler, or this fixture has stopped proving anything.
  const reactInput = page.locator("#react-name");
  await reactInput.evaluate((el: HTMLInputElement) => {
    el.value = "bypassed";
  });
  await expect(reactInput).toHaveValue("");

  // 2. Masked phone: typing digits produces a reformatted value, not the
  // raw keystrokes.
  await page.locator("#masked-phone").pressSequentially("5551234567");
  await expect(page.locator("#masked-phone")).toHaveValue("(555) 123-4567");

  // 3. Custom combobox: a `<div>`, not a native control, and setting
  // `.value` on it does nothing — only a click on an option works.
  await expect(page.locator("#combo-input")).toHaveAttribute(
    "role",
    "combobox",
  );
  await page.locator("#combo-input").click();
  await page.getByRole("option", { name: "India" }).click();
  await expect(page.locator("#combo-input")).toHaveText("India");

  // 4. Strict-format date: an invalid format is silently reverted.
  const dateInput = page.locator("#strict-date");
  await dateInput.fill("15/06/1990");
  await dateInput.blur();
  await expect(dateInput).toHaveValue("15/06/1990");
  await dateInput.fill("not-a-date");
  await dateInput.blur();
  await expect(dateInput).toHaveValue("15/06/1990");
});

test("supabase.html exposes an ATS application form with generated field names", async ({
  page,
}) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "localhost"
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await page.goto("/supabase.html", { waitUntil: "domcontentloaded" });

  const labelledControls = page.locator("#form label[for]");
  await expect(labelledControls).toHaveCount(12);

  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.locator("#_systemfield_resume")).toHaveAttribute(
    "type",
    "file",
  );
  await expect(page.getByLabel("Passport Country")).toBeVisible();
  await expect(page.getByLabel("Country of Residence")).toBeVisible();
  await expect(page.getByLabel("Github Profile")).toBeVisible();
  await expect(page.getByLabel("Linkedin")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload File", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit Application" }),
  ).toBeVisible();

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
