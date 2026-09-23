import { expect, test } from "./fill-fixtures";
import { openPanel } from "./fill-helpers";

/**
 * The e2e build pre-grants `http://localhost:4173/*` only. The same fixture
 * server reached as `127.0.0.1` is a different origin, so it is an ordinary
 * http page the extension has no access to yet.
 */
const UNGRANTED_URL = "http://127.0.0.1:4173/simple.html";

test("an ungranted page shows the needs-access notice and a refresh chip up front", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(UNGRANTED_URL);
  const panelPage = await openPanel(context, extensionId);
  await page.bringToFront();

  await expect(panelPage.getByTestId("scan-needs-access")).toBeVisible({
    timeout: 10_000,
  });
  await expect(panelPage.getByTestId("scan-refresh-tip")).toBeVisible();
  // The chip lives beside the Scan button, not inside the notice.
  await expect(
    panelPage.getByTestId("scan-needs-access").getByTestId("scan-refresh-tip"),
  ).toHaveCount(0);
});

test("the refresh chip reloads the active tab", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(UNGRANTED_URL);
  const panelPage = await openPanel(context, extensionId);
  await page.bringToFront();
  await expect(panelPage.getByTestId("scan-refresh-tip")).toBeVisible({
    timeout: 10_000,
  });

  const reloaded = page.waitForEvent("load");
  await panelPage.getByTestId("scan-refresh-tip").click();
  await reloaded;
});

test("a granted page shows neither the notice nor the chip", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto("/simple.html");
  const panelPage = await openPanel(context, extensionId);
  await page.bringToFront();

  await expect(
    panelPage.getByText(/This site only:|Access is on for/),
  ).toBeVisible({ timeout: 10_000 });
  await expect(panelPage.getByTestId("scan-needs-access")).toBeHidden();
  await expect(panelPage.getByTestId("scan-refresh-tip")).toBeHidden();
});
