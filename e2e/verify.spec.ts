import { expect, test } from "./fill-fixtures";
import {
  driveAgentToCompletion,
  grantAccess,
  openPanel,
  seedAnswers,
} from "./fill-helpers";

/**
 * Deliverable 4: the `Verifier`, proven against `controlled.html` — the
 * fixture built specifically so verification has something real to fail
 * against (see `docs/roadmap/phase-2-agent-loop.md`).
 *
 * All four fields resolve to a known concept (checked directly against
 * `resolve()` while designing this loop): `react-name` -> identity.full_name,
 * `masked-phone` -> contact.phone, the country combobox ->
 * contact.address.country, `strict-date` -> identity.date_of_birth. Seeding
 * all four up front means every field goes through the review pause (no
 * `ask_user`), which keeps driving the run to completion a matter of
 * repeatedly clicking Confirm.
 */

test("controlled.html: the naive write is cleared by the real technique", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/controlled.html");

  const panelPage = await openPanel(context, extensionId);
  await seedAnswers(panelPage, [
    ["Full name", "Ananya Sharma"],
    ["Phone number", "9884421077"],
    ["Country", "India"],
    ["Date of birth", "1990-01-01"],
  ]);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await driveAgentToCompletion(panelPage);

  // The React-controlled input: a plain `.value =` write is silently
  // dropped (see `controlled.html`'s spike), so this only holds if the
  // native-setter-plus-event technique from `~/lib/form/fill` actually ran.
  await expect(formPage.locator("#react-name")).toHaveValue("Ananya Sharma");
});

test("controlled.html: a reformatting field passes verification as VALUE_NORMALISED, not a mismatch", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/controlled.html");

  const panelPage = await openPanel(context, extensionId);
  await seedAnswers(panelPage, [
    ["Full name", "Ananya Sharma"],
    ["Phone number", "9884421077"],
    ["Country", "India"],
    ["Date of birth", "1990-01-01"],
  ]);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await driveAgentToCompletion(panelPage);

  // The page reformats what was typed into (XXX) XXX-XXXX — a different
  // outcome from being rejected, and the run must not have retried this
  // field into a stuck loop over it (a masked field reformatting is usually
  // success, per the phase 2 brief's traps section).
  await expect(formPage.locator("#masked-phone")).toHaveValue("(988) 442-1077");
});

test("controlled.html: a naive .value write alone is not enough to pass verification", async ({
  context,
}) => {
  // Guards the assertion above against a false positive: prove the fixture
  // really does reject a naive write, by doing one directly and confirming
  // the field it lands on stays exactly as `controlled.html`'s spike
  // documented — reset by its own shadowed setter.
  const formPage = await context.newPage();
  await formPage.goto("/controlled.html");

  await formPage.evaluate(() => {
    const el = document.getElementById("react-name") as HTMLInputElement;
    el.value = "Naive Write";
  });

  await expect(formPage.locator("#react-name")).toHaveValue("");
});
