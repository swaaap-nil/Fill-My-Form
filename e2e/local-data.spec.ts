import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fill-fixtures";
import { grantAccess, openPanel, seedAnswer } from "./fill-helpers";

test("local data: export, wipe, and import round-trips memory and journal", async ({
  context,
  extensionId,
}, testInfo) => {
  const formPage = await context.newPage();
  await formPage.goto("/messy.html");

  const panelPage = await openPanel(context, extensionId);
  await seedAnswer(panelPage, "First name", "Ananya");
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Scan this page" }).click();
  await panelPage.getByRole("button", { name: "My information" }).click();

  const downloadPromise = panelPage.waitForEvent("download");
  await panelPage.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  const exportPath = await download.path();
  expect(exportPath).toBeTruthy();
  if (!exportPath) throw new Error("export download did not produce a path");

  const exported = JSON.parse(await readFile(exportPath, "utf8")) as {
    readonly memory: readonly { readonly key: string }[];
    readonly journal: readonly { readonly fieldKey: string }[];
  };
  expect(exported.memory.map((item) => item.key)).toContain(
    "identity.first_name",
  );
  expect(exported.journal.length).toBeGreaterThan(0);

  await panelPage.getByRole("button", { name: "Wipe" }).click();
  await panelPage.getByLabel(/type delete my data/i).fill("delete my data");
  await panelPage.getByRole("button", { name: "Delete" }).click();
  await expect(panelPage.getByTestId("saved-count")).toContainText("0 values");

  const importPath = join(testInfo.outputDir, "local-data-export.json");
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(importPath, JSON.stringify(exported));
  await panelPage
    .locator('input[type="file"][accept="application/json"]')
    .setInputFiles(importPath);

  await expect(panelPage.getByTestId("saved-count")).toContainText("1 value");

  const secondDownloadPromise = panelPage.waitForEvent("download");
  await panelPage.getByRole("button", { name: "Export" }).click();
  const secondDownload = await secondDownloadPromise;
  const secondPath = await secondDownload.path();
  expect(secondPath).toBeTruthy();
  if (!secondPath) throw new Error("second export did not produce a path");

  const reexported = JSON.parse(await readFile(secondPath, "utf8")) as {
    readonly memory: readonly { readonly key: string }[];
    readonly journal: readonly { readonly fieldKey: string }[];
  };
  expect(reexported.memory.map((item) => item.key)).toEqual(
    exported.memory.map((item) => item.key),
  );
  expect(reexported.journal.map((entry) => entry.fieldKey).sort()).toEqual(
    exported.journal.map((entry) => entry.fieldKey).sort(),
  );
});
