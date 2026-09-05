import { expect, test } from "./fill-fixtures";
import {
  driveAgentToCompletion,
  grantAccess,
  openPanel,
  seedAnswers,
} from "./fill-helpers";

/**
 * Deliverable 5: re-observation on `dynamic.html` — 1 field injected at
 * 600ms, 3 more after a step transition. Observation must be re-run rather
 * than cached, and a `FORM_CHANGED` issue must route the run back to PLAN,
 * never straight to ACT.
 *
 * `~/core/tests/agent-loop.test.ts` already pins the precise mechanics
 * (re-extraction inside VERIFY, merging a brand-new field's match/value,
 * routing to PLAN) against fakes, with exact control over *when* the new
 * field appears relative to the write. This spec proves the same code path
 * survives contact with the real content script and a real fixture:
 * `email` -> `contact.email` is the only field visible when the run starts,
 * `referral` (unknown to the ontology, so skipped either way) is injected
 * mid-run by the fixture's own 600ms timer, and the run must still
 * complete rather than getting stuck re-checking a cached field list.
 *
 * **The second test below ("fields revealed by a step transition") is known
 * to hang under host resource pressure**, timing out waiting on a button
 * that plainly exists in the component tree — see "Known flakiness" in
 * docs/testing.md before assuming a regression here. Check `uptime`/free
 * memory and retry in isolation first.
 */

test("dynamic.html: a field injected mid-run does not get missed or get the run stuck", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/dynamic.html");

  const panelPage = await openPanel(context, extensionId);
  await seedAnswers(panelPage, [["Email address", "ananya@example.com"]]);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  // A real DOM condition, not a fixed sleep: guarantees the fixture's
  // 600ms-delayed field exists before the agent's one write-and-verify
  // cycle for `email` runs, so the re-extraction inside VERIFY is the one
  // that has to notice it.
  await formPage.locator("#referral").waitFor({ state: "attached" });

  await driveAgentToCompletion(panelPage);

  await expect(formPage.getByLabel("Email address")).toHaveValue(
    "ananya@example.com",
  );
});

test("dynamic.html: fields revealed by a step transition are reachable by re-running the agent", async ({
  context,
  extensionId,
}) => {
  const formPage = await context.newPage();
  await formPage.goto("/dynamic.html");

  const panelPage = await openPanel(context, extensionId);
  await seedAnswers(panelPage, [
    ["Email address", "ananya@example.com"],
    ["Undergraduate institution", "IIT Bombay"],
    ["Undergraduate completion year", "2015"],
    ["Current salary", "1800000"],
  ]);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await driveAgentToCompletion(panelPage);
  await expect(formPage.getByLabel("Email address")).toHaveValue(
    "ananya@example.com",
  );

  // Step 2's fields do not exist until this click — a page-level transition
  // the agent has no tool to perform itself (`AgentAction` is fill-only).
  await formPage.getByRole("button", { name: "Continue" }).click();
  await formPage.locator("#college").waitFor({ state: "attached" });

  // The previous run completed and was cleared; this starts a fresh one,
  // observing the page as it is *now* — including the fields that did not
  // exist at the start of the test.
  await driveAgentToCompletion(panelPage);

  await expect(formPage.getByLabel("College / university")).toHaveValue(
    "IIT Bombay",
  );
  await expect(formPage.getByLabel("Year of graduation")).toHaveValue("2015");
  await expect(formPage.getByLabel("Current CTC")).toHaveValue("1800000");
});
