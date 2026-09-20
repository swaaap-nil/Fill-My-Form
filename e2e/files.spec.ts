import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fill-fixtures";
import {
  grantAccess,
  openPanel,
  openProposalDetails,
  seedFile,
} from "./fill-helpers";

const writeFixture = async (path: string, bytes: Uint8Array) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
};

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = new TextEncoder().encode(type);
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(typeBytes, 4);
  bytes.set(data, 8);
  view.setUint32(
    8 + data.length,
    crc32(new Uint8Array([...typeBytes, ...data])),
  );
  return bytes;
};

const png = (width: number, height: number): Uint8Array => {
  const stride = 1 + width * 3;
  const pixels = new Uint8Array(stride * height);

  for (let y = 0; y < height; y++) {
    pixels[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const offset = y * stride + 1 + x * 3;
      pixels[offset] = x % 256;
      pixels[offset + 1] = y % 256;
      pixels[offset + 2] = (x + y) % 256;
    }
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;

  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", header),
    ...chunk("IDAT", deflateSync(pixels)),
    ...chunk("IEND", new Uint8Array()),
  ]);
};

const answerForQuestion = (question: string): string => {
  if (question.includes("Email")) return "ananya@example.com";
  if (question.includes("Mobile") || question.includes("Phone"))
    return "9876543210";
  if (question.includes("Date of birth")) return "2000-01-01";
  if (question.includes("Passing Year")) return "2016";
  if (question.includes("degree")) return "btech";
  if (question.includes("College")) return "Example College";
  if (question.includes("Last name")) return "Rao";
  return "Ananya";
};

/**
 * The editor runs in its own extension window. Match it by URL rather than
 * taking the next `page` event: the popup is not necessarily the only page the
 * context opens, and a mis-matched one fails far from the cause.
 */
const waitForEditorPage = async (context: BrowserContext): Promise<Page> => {
  const isEditor = (page: Page) => page.url().includes("editor.html");
  const existing = context.pages().find(isEditor);
  if (existing) return existing;
  return context.waitForEvent("page", { predicate: isEditor });
};

const advanceAgentToFileQuestion = async (panelPage: Page) => {
  await panelPage.getByRole("button", { name: "Scan this page" }).click();
  await panelPage.getByRole("button", { name: "Answer now" }).click();

  for (let i = 0; i < 20; i++) {
    if (await panelPage.getByText("Browse or drag a file here").isVisible()) {
      return;
    }

    const confirmButton = panelPage
      .getByRole("button", { name: "Confirm", exact: true })
      .first();
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click({ timeout: 3000 }).catch(() => {});
      continue;
    }

    const answerButton = panelPage.getByRole("button", {
      name: "Answer",
      exact: true,
    });
    if (await answerButton.isVisible().catch(() => false)) {
      const question =
        (await panelPage
          .getByText(/^What should go in/)
          .first()
          .textContent()) ?? "";
      await panelPage
        .getByPlaceholder("Your answer")
        .fill(answerForQuestion(question));
      await answerButton.click({ timeout: 3000 }).catch(() => {});
      continue;
    }

    await panelPage.waitForTimeout(250);
  }

  throw new Error("Agent did not reach a file question.");
};

test("files: a saved resume PDF uploads on simple.html", async ({
  context,
  extensionId,
}, testInfo) => {
  const pdfPath = testInfo.outputPath("resume.pdf");
  await writeFixture(
    pdfPath,
    new TextEncoder().encode(
      "%PDF-1.4\n% sentinel-resume-content-never-for-prompts\n",
    ),
  );

  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await seedFile(
    panelPage,
    "Resume",
    pdfPath,
    "autosave-status-documents.resume",
  );
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Scan this page" }).click();
  await openProposalDetails(panelPage);
  await expect(panelPage.getByText("documents.resume")).toBeVisible();
  await panelPage
    .getByRole("button", { name: "Confirm", exact: true })
    .first()
    .click();

  const selectedName = await formPage
    .locator("#resume")
    .evaluate((el) => (el as HTMLInputElement).files?.[0]?.name);
  expect(selectedName).toBe("resume.pdf");
});

test("files: agent asks for browsing or drag-and-drop when a needed file is missing", async ({
  context,
  extensionId,
}, testInfo) => {
  const pdfPath = testInfo.outputPath("resume-from-question.pdf");
  await writeFixture(
    pdfPath,
    new TextEncoder().encode("%PDF-1.4\n% agent-file-question\n"),
  );

  const formPage = await context.newPage();
  await formPage.goto("/simple.html");

  const panelPage = await openPanel(context, extensionId);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await advanceAgentToFileQuestion(panelPage);

  await expect(panelPage.getByText("Browse or drag a file here")).toBeVisible();
  await expect(panelPage.getByPlaceholder("Your answer")).toHaveCount(0);

  await panelPage.locator('input[type="file"]').setInputFiles(pdfPath);
  await expect(panelPage.getByText("resume-from-question.pdf")).toBeVisible();
  await panelPage.getByRole("button", { name: "Answer", exact: true }).click();

  const selectedName = await formPage
    .locator("#resume")
    .evaluate((el) => (el as HTMLInputElement).files?.[0]?.name);
  expect(selectedName).toBe("resume-from-question.pdf");
});

test("files: an oversized photo is transformed before upload", async ({
  context,
  extensionId,
}, testInfo) => {
  const photoPath = testInfo.outputPath("photo.png");
  await writeFixture(photoPath, png(160, 160));

  const formPage = await context.newPage();
  await formPage.goto("/image-max-size.html");

  const panelPage = await openPanel(context, extensionId);
  await seedFile(panelPage, "Photograph", photoPath);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Scan this page" }).click();
  await openProposalDetails(panelPage);
  await expect(panelPage.getByText("documents.photo")).toBeVisible();
  await panelPage.getByRole("button", { name: "Confirm", exact: true }).click();

  const uploaded = await formPage.locator("#photo").evaluate((el) => {
    const file = (el as HTMLInputElement).files?.[0];
    return file
      ? { name: file.name, type: file.type, size: file.size }
      : undefined;
  });
  expect(uploaded?.name).toBe("photo.jpg");
  expect(uploaded?.type).toBe("image/jpeg");
  expect(uploaded?.size).toBeLessThanOrEqual(8000);
});

test("files: standalone preparation tool creates a temporary image copy", async ({
  context,
  extensionId,
}, testInfo) => {
  const photoPath = testInfo.outputPath("standalone-photo.png");
  await writeFixture(photoPath, png(160, 120));

  const panelPage = await openPanel(context, extensionId);
  await panelPage.getByRole("button", { name: "Prepare file" }).click();
  await panelPage.locator('input[type="file"]').setInputFiles(photoPath);
  await expect(panelPage.getByText("standalone-photo.png")).toBeVisible();

  await panelPage
    .getByRole("button", { name: "Prepare temporary copy" })
    .click();
  await expect(panelPage.getByText("Ready to upload")).toBeVisible();
  await expect(
    panelPage.getByText("Drag this file to your form"),
  ).toBeVisible();
  await expect(
    panelPage.getByTestId("prepared-file-drag-surface"),
  ).toHaveAttribute("draggable", "true");
  await expect(
    panelPage.getByRole("link", { name: "Download prepared copy" }),
  ).toBeVisible();
});

test("files: standalone preparation tool can use a saved onboarding document", async ({
  context,
  extensionId,
}, testInfo) => {
  const photoPath = testInfo.outputPath("saved-photo.png");
  await writeFixture(photoPath, png(180, 140));

  const panelPage = await openPanel(context, extensionId);
  await seedFile(panelPage, "Photograph", photoPath);

  await panelPage.getByRole("button", { name: "Prepare file" }).click();
  await expect(
    panelPage.getByRole("combobox", { name: "Pick a saved file" }),
  ).toBeVisible();

  await panelPage.getByRole("combobox", { name: "Pick a saved file" }).click();
  await panelPage
    .getByRole("option", { name: /Photograph.*saved-photo\.png/ })
    .click();
  await panelPage.getByRole("button", { name: "Use this" }).click();
  await expect(panelPage.getByText("saved-photo.png")).toBeVisible();

  await panelPage
    .getByRole("button", { name: "Prepare temporary copy" })
    .click();
  await expect(panelPage.getByText("Ready to upload")).toBeVisible();
  await expect(
    panelPage.getByTestId("prepared-file-drag-surface"),
  ).toHaveAttribute("draggable", "true");
});

test("files: unsupported saved onboarding documents are shown but disabled", async ({
  context,
  extensionId,
}, testInfo) => {
  const signaturePath = testInfo.outputPath("signature.txt");
  await writeFixture(signaturePath, new TextEncoder().encode("signature"));

  const panelPage = await openPanel(context, extensionId);
  await seedFile(panelPage, "Signature", signaturePath);

  await panelPage.getByRole("button", { name: "Prepare file" }).click();
  await panelPage.getByRole("combobox", { name: "Pick a saved file" }).click();
  await expect(
    panelPage.getByRole("option", {
      name: /Signature.*signature\.txt.*unsupported/,
    }),
  ).toBeDisabled();
  await expect(
    panelPage.getByText("Images and PDFs can be prepared here."),
  ).toBeVisible();
  await expect(
    panelPage.getByRole("button", { name: "Use this" }),
  ).toBeDisabled();
});

test("files: physical units and a size limit in MB reach the prepared copy", async ({
  context,
  extensionId,
}, testInfo) => {
  const photoPath = testInfo.outputPath("units-photo.png");
  await writeFixture(photoPath, png(640, 480));

  const panelPage = await openPanel(context, extensionId);
  await panelPage.getByRole("button", { name: "Prepare file" }).click();
  await panelPage.locator('input[type="file"]').setInputFiles(photoPath);
  await expect(panelPage.getByText("units-photo.png")).toBeVisible();

  // A preset states its requirement in the unit the paperwork uses. The
  // conversion to pixels is the thing worth pinning: it only works because a
  // DPI is carried alongside the millimetres.
  await panelPage.getByRole("combobox", { name: "Preset" }).click();
  await panelPage.getByRole("option", { name: "Passport / ID photo" }).click();
  await expect(
    panelPage.getByText("35 × 45 mm at 300 DPI = 413 × 531 px"),
  ).toBeVisible();

  // The limit is expressible in MB, which the old KB-only field could not do.
  await panelPage.getByLabel("Max file size").fill("2");
  await panelPage.getByRole("combobox").nth(3).click();
  await panelPage.getByRole("option", { name: "MB", exact: true }).click();

  await panelPage
    .getByRole("button", { name: "Prepare temporary copy" })
    .click();
  await expect(panelPage.getByText("Ready to upload")).toBeVisible();
  await expect(
    panelPage.getByText("Drag this passport / id photo to your form"),
  ).toBeVisible();
  await expect(panelPage.getByText("413 × 531px")).toBeVisible();
});

test("files: the aspect lock derives the other dimension", async ({
  context,
  extensionId,
}, testInfo) => {
  const photoPath = testInfo.outputPath("lock-photo.png");
  await writeFixture(photoPath, png(640, 480));

  const panelPage = await openPanel(context, extensionId);
  await panelPage.getByRole("button", { name: "Prepare file" }).click();
  await panelPage.locator('input[type="file"]').setInputFiles(photoPath);
  await expect(panelPage.getByText("lock-photo.png")).toBeVisible();

  await panelPage.getByRole("checkbox", { name: "Lock aspect ratio" }).click();
  await panelPage.getByRole("textbox", { name: "Aspect ratio" }).fill("4:5");
  await panelPage.getByLabel("Width", { exact: true }).fill("400");

  // Typing one side fills the other. Without the lock the export would keep
  // the source's own height and silently stretch the image.
  await expect(panelPage.getByLabel("Height", { exact: true })).toHaveValue(
    "500",
  );
});

test("files: the editor window opens and its crop cannot leave the image", async ({
  context,
  extensionId,
}, testInfo) => {
  const photoPath = testInfo.outputPath("editor-photo.png");
  await writeFixture(photoPath, png(640, 480));

  const panelPage = await openPanel(context, extensionId);
  await panelPage.getByRole("button", { name: "Prepare file" }).click();
  await panelPage.locator('input[type="file"]').setInputFiles(photoPath);
  await expect(panelPage.getByText("editor-photo.png")).toBeVisible();

  await panelPage.getByRole("button", { name: "Edit image" }).click();
  const editorPage = await waitForEditorPage(context);
  await editorPage.waitForLoadState("domcontentloaded");

  await expect(editorPage.getByTestId("editor-root")).toBeVisible();
  await expect(
    editorPage.getByRole("button", { name: "Apply crop" }),
  ).toBeVisible();

  const stage = editorPage.locator("cropper-canvas");
  await expect(stage).toBeVisible();

  // The regression test for the reported bug. Drag the selection hard past the
  // top-left of the picture; it must stay inside it. Before the clamp, the box
  // could be pulled off the image and the export gained blank strips.
  const box = await stage.boundingBox();
  if (!box) throw new Error("The crop stage did not render.");
  await editorPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await editorPage.mouse.down();
  await editorPage.mouse.move(box.x - 600, box.y - 600, { steps: 12 });
  await editorPage.mouse.up();

  const containment = await editorPage.evaluate(() => {
    const image = document.querySelector("cropper-image");
    const selection = document.querySelector("cropper-selection");
    if (!image || !selection) return undefined;
    const imageRect = image.getBoundingClientRect();
    const selectionRect = selection.getBoundingClientRect();
    return {
      left: selectionRect.left - imageRect.left,
      top: selectionRect.top - imageRect.top,
      right: imageRect.right - selectionRect.right,
      bottom: imageRect.bottom - selectionRect.bottom,
    };
  });
  if (!containment) throw new Error("The cropper elements did not render.");

  // A pixel of slack for sub-pixel layout rounding.
  expect(containment.left).toBeGreaterThan(-1);
  expect(containment.top).toBeGreaterThan(-1);
  expect(containment.right).toBeGreaterThan(-1);
  expect(containment.bottom).toBeGreaterThan(-1);

  await editorPage.getByRole("button", { name: "Apply crop" }).click();
  await expect(panelPage.getByText("Using cropped image")).toBeVisible();
  await expect(panelPage.getByTestId("prepared-file-drag-surface")).toHaveCount(
    0,
  );

  // Re-prepare at a form-required size must resize the editor crop, not re-slice
  // the original using canvas-space crop coordinates (NW-corner regression).
  await panelPage.getByLabel("Width", { exact: true }).fill("100");
  await panelPage.getByLabel("Height", { exact: true }).fill("120");
  await panelPage
    .getByRole("button", { name: "Prepare temporary copy" })
    .click();
  await expect(
    panelPage.getByTestId("prepared-file-drag-surface"),
  ).toBeVisible();
  await expect(panelPage.getByText("100 x 120 px")).toBeVisible();
});

test("files: cancelling the editor leaves the panel untouched", async ({
  context,
  extensionId,
}, testInfo) => {
  const photoPath = testInfo.outputPath("cancel-photo.png");
  await writeFixture(photoPath, png(320, 240));

  const panelPage = await openPanel(context, extensionId);
  await panelPage.getByRole("button", { name: "Prepare file" }).click();
  await panelPage.locator('input[type="file"]').setInputFiles(photoPath);
  await expect(panelPage.getByText("cancel-photo.png")).toBeVisible();

  await panelPage.getByRole("button", { name: "Edit image" }).click();
  const editorPage = await waitForEditorPage(context);
  await editorPage.waitForLoadState("domcontentloaded");
  await editorPage.getByRole("button", { name: "Cancel" }).click();

  await expect(panelPage.getByText("Ready to upload")).toHaveCount(0);
  await expect(
    panelPage.getByRole("button", { name: "Prepare temporary copy" }),
  ).toBeVisible();
});
