import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";
import { expect, test } from "./fill-fixtures";
import { grantAccess, openPanel, seedFile } from "./fill-helpers";

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
  await seedFile(panelPage, "Resume", pdfPath);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Scan this page" }).click();
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

test("files: an oversized photo is transformed before upload", async ({
  context,
  extensionId,
}, testInfo) => {
  const photoPath = testInfo.outputPath("photo.png");
  await writeFixture(photoPath, png(160, 160));

  const formPage = await context.newPage();
  await formPage.goto("/simple.html");
  await formPage.evaluate(() => {
    const form = document.querySelector("form");
    if (!form) throw new Error("fixture form missing");
    const label = document.createElement("label");
    label.htmlFor = "photo";
    label.textContent = "Passport size photo";
    const input = document.createElement("input");
    input.id = "photo";
    input.name = "photo";
    input.type = "file";
    input.accept = "image/*";
    input.dataset.maxFileSizeBytes = "8000";
    form.append(label, input);
  });

  const panelPage = await openPanel(context, extensionId);
  await seedFile(panelPage, "Photograph", photoPath);
  await grantAccess(formPage, panelPage);

  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Scan this page" }).click();
  await expect(panelPage.getByText("documents.photo")).toBeVisible();
  await panelPage
    .getByRole("button", { name: "Confirm", exact: true })
    .first()
    .click();

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
