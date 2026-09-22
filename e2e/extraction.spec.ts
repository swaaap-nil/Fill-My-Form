import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Page } from "@playwright/test";
import type { Form, PageObservation } from "../src/core/form/types";
import { resolve as resolveMatch } from "../src/core/matching/resolve";
import { ontology } from "../src/core/ontology";
import { expect, test } from "./fixtures";

/**
 * Goldens for the DOM → `FormIR` extractor.
 *
 * The extractor is built standalone (`bun run build:extractor`) and injected
 * with `page.addScriptTag()` — no extension, no manifest, no permissions.
 * This keeps the highest-value test in phase 1a independent of site-access
 * wiring, which does not exist until Phase 1c.
 *
 * `bun run goldens:update` regenerates the committed files under
 * `e2e/goldens/` so a change in extraction behaviour arrives as a reviewable
 * diff, never a silent one.
 */

const EXTRACTOR_PATH = resolve(process.cwd(), "build/extractor/extractor.js");
const GOLDENS_DIR = resolve(process.cwd(), "e2e/goldens");
const UPDATE = process.env.UPDATE_GOLDENS === "1";

/** Stands in for the real timestamp so goldens do not churn on every run. */
const FIXED_OBSERVED_AT = "<observedAt>";

declare global {
  interface Window {
    __formAgentExtract?: (doc?: Document) => PageObservation;
    __formAgentExtractFull?: (doc?: Document) => Form[];
  }
}

const injectExtractor = async (page: Page) => {
  if (!existsSync(EXTRACTOR_PATH)) {
    throw new Error(
      `No extractor bundle at ${EXTRACTOR_PATH}. Run \`bun run build:extractor\` ` +
        "(or `bun test:e2e`, which does this for you).",
    );
  }
  await page.addScriptTag({ path: EXTRACTOR_PATH });
};

const observe = (page: Page) =>
  page.evaluate(() => {
    const extract = window.__formAgentExtract;
    if (!extract) throw new Error("extractor did not attach to window");
    return extract();
  });

const observeFull = (page: Page) =>
  page.evaluate(() => {
    const extractFull = window.__formAgentExtractFull;
    if (!extractFull) throw new Error("extractor did not attach to window");
    return extractFull();
  });

const normaliseObservation = (obs: PageObservation): PageObservation => ({
  ...obs,
  observedAt: FIXED_OBSERVED_AT,
});

/** Compares against, or (with `UPDATE_GOLDENS=1`) writes, a committed golden. */
const assertMatchesGolden = async (name: string, actual: unknown) => {
  const path = resolve(GOLDENS_DIR, `${name}.json`);

  if (UPDATE) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }

  if (!existsSync(path)) {
    throw new Error(
      `No golden at ${path}. Run \`bun run goldens:update\` to generate it, ` +
        "then review the diff before committing.",
    );
  }
  const golden = JSON.parse(await readFile(path, "utf8"));
  expect(actual).toEqual(golden);
};

for (const fixture of ["simple", "messy", "controlled"] as const) {
  test(`${fixture}.html extracts to the committed golden`, async ({ page }) => {
    await page.goto(`/${fixture}.html`);
    await injectExtractor(page);

    const observation = normaliseObservation(await observe(page));
    await assertMatchesGolden(`${fixture}.observation`, observation);

    const full = await observeFull(page);
    await assertMatchesGolden(`${fixture}.full`, full);
  });
}

test("dynamic.html extracts to the committed golden before any injection fires", async ({
  page,
}) => {
  // Freezes the fixture's own timers so the pre-injection snapshot this
  // golden pins cannot flake under a slow CI runner.
  await page.addInitScript(() => {
    window.setTimeout = (() => 0) as unknown as typeof window.setTimeout;
  });

  await page.goto("/dynamic.html");
  await injectExtractor(page);

  const observation = normaliseObservation(await observe(page));
  await assertMatchesGolden("dynamic.observation", observation);

  const full = await observeFull(page);
  await assertMatchesGolden("dynamic.full", full);
});

test("sentinel: a filled value never appears in the observation, only hasValue does", async ({
  page,
}) => {
  await page.goto("/simple.html");
  await page.getByLabel("Email address").fill("sentinel-abc-123@example.com");
  await injectExtractor(page);

  const observation = await observe(page);

  expect(JSON.stringify(observation)).not.toContain("sentinel-abc-123");

  const emailField = observation.forms[0]?.fields.find(
    (f) => f.label === "Email address",
  );
  expect(emailField?.hasValue).toBe(true);
});

test("field ids on dynamic.html survive the step-1 to step-2 transition", async ({
  page,
}) => {
  await page.goto("/dynamic.html");
  await injectExtractor(page);

  const before = await observe(page);
  const idsBefore = before.forms[0]?.fields.map((f) => f.id) ?? [];
  expect(idsBefore.length).toBeGreaterThan(0);

  await page.getByLabel("Email address").fill("someone@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("College / university")).toBeVisible();

  const after = await observe(page);
  const idsAfter = after.forms[0]?.fields.map((f) => f.id) ?? [];

  for (const id of idsBefore) {
    expect(idsAfter).toContain(id);
  }
});

test("the 600ms injected referral field appears only in a re-observation", async ({
  page,
}) => {
  // Installed before navigation so the fixture's own setTimeout(600) is
  // paused from the moment its script runs — the first `observe()` below is
  // then guaranteed to land before it fires, no matter how long page load +
  // extractor injection take in wall-clock time. Without this, a slow CI
  // runner can burn past 600ms of real time before the first `observe()`
  // ever runs, making the field already present and this assertion flaky.
  await page.clock.install();
  await page.goto("/dynamic.html");
  await injectExtractor(page);

  const first = await observe(page);
  const labelsBefore = first.forms[0]?.fields.map((f) => f.label) ?? [];
  expect(labelsBefore).not.toContain("How did you hear about us?");

  // Deterministically fire the fixture's 600ms timer instead of waiting on
  // real time.
  await page.clock.fastForward(600);
  await page.locator("#referral").waitFor({ state: "attached" });

  const second = await observe(page);
  const labelsAfter = second.forms[0]?.fields.map((f) => f.label) ?? [];
  expect(labelsAfter).toContain("How did you hear about us?");
});

test("controlled.html's four hard controls extract with the right FieldKind", async ({
  page,
}) => {
  await page.goto("/controlled.html");
  await injectExtractor(page);

  const full = await observeFull(page);
  const fields = full[0]?.fields ?? [];
  const byName = (name: string) => fields.find((f) => f.name === name);

  expect(byName("react_name")?.kind).toBe("text");
  expect(byName("masked_phone")?.kind).toBe("tel");
  expect(byName("strict_dob")?.kind).toBe("text");

  // The combobox is a `<div>`, has no `name`, and is identified by label.
  const combobox = fields.find((f) => f.label === "Country");
  expect(combobox?.kind).toBe("unknown");
  expect(combobox?.options?.map((o) => o.label)).toEqual([
    "India",
    "United States",
    "United Kingdom",
  ]);
});

test("radio groups without fieldsets use the shared question label", async ({
  page,
}) => {
  await page.setContent(`
    <form>
      <div class="form-group">
        <label>Preferred language</label>
        <div><input type="radio" id="lang-en" name="language" value="en"><label for="lang-en">English</label></div>
        <div><input type="radio" id="lang-hi" name="language" value="hi"><label for="lang-hi">Hindi</label></div>
      </div>
    </form>
  `);
  await injectExtractor(page);

  const full = await observeFull(page);
  const language = full[0]?.fields.find((f) => f.name === "language");

  expect(language?.kind).toBe("radio");
  expect(language?.label).toBe("Preferred language");
  expect(language?.options?.map((option) => option.label)).toEqual([
    "English",
    "Hindi",
  ]);
});

test("row-labelled Material-style controls use the row prompt, not proxy text", async ({
  page,
}) => {
  await page.setContent(`
    <form>
      <div class="row">
        <span>Nationality</span>
        <div>
          <div tabindex="0" role="combobox" aria-labelledby="nationality" id="nationality">
            <em>Select Country</em>
          </div>
          <input aria-hidden="true" tabindex="-1" name="nationality" value="-1">
        </div>
      </div>
      <div class="row">
        <span>Category</span>
        <div role="radiogroup">
          <label><input type="radio" name="category" value="1">GEN</label>
          <label><input type="radio" name="category" value="2">OBC-NCL</label>
        </div>
      </div>
      <div class="row">
        <span>Person with Disability (PwD)</span>
        <div role="radiogroup">
          <label><input type="radio" name="pwd" value="true">Yes</label>
          <label><input type="radio" name="pwd" value="false">No</label>
        </div>
      </div>
    </form>
  `);
  await injectExtractor(page);

  const full = await observeFull(page);
  const fields = full[0]?.fields ?? [];

  expect(fields).toHaveLength(3);
  expect(fields.map((field) => field.label)).toEqual([
    "Nationality",
    "Category",
    "Person with Disability (PwD)",
  ]);
  expect(fields.some((field) => field.name === "nationality")).toBe(false);
});

test("ibps-like.html labels the file field from the upload prompt, not picker chrome", async ({
  page,
}) => {
  await page.goto("/ibps-like.html");
  await injectExtractor(page);

  const full = await observeFull(page);
  const fields = full[0]?.fields ?? [];
  const photo = fields.find((f) => f.name === "photographUpload");
  const signature = fields.find((f) => f.name === "signatureUpload");

  expect(photo?.kind).toBe("file");
  expect(photo?.label).toBe("Scanned Photograph of the Candidate:");
  expect(photo?.label).not.toBe("Choose file");
  expect(signature?.kind).toBe("file");
  expect(signature?.label).toBe("Scanned Signature of the Candidate:");
  expect(signature?.label).not.toBe("Choose file");
});

test("aai-copied.html recognises copied photo and signature upload fields", async ({
  page,
}) => {
  await page.goto("/aai-copied.html", { waitUntil: "domcontentloaded" });
  await injectExtractor(page);

  const full = await observeFull(page);
  const fields = full[0]?.fields ?? [];
  const photo = fields.find((f) => f.name === "picture");
  const signature = fields.find((f) => f.name === "signature");

  expect(photo).toBeDefined();
  expect(signature).toBeDefined();
  if (!photo || !signature) {
    throw new Error("AAI upload fields were not extracted");
  }

  expect(photo.kind).toBe("file");
  expect(photo.label).toBe("Scanned Photograph of the Candidate:");
  expect(resolveMatch(photo, ontology).candidates[0]?.conceptKey).toBe(
    "documents.photo",
  );

  expect(signature.kind).toBe("file");
  expect(signature.label).toBe("Scanned Signature of the Candidate:");
  expect(resolveMatch(signature, ontology).candidates[0]?.conceptKey).toBe(
    "documents.signature",
  );
});

test("aai-more.html has no upload fields to recognise", async ({ page }) => {
  await page.goto("/aai-more.html", { waitUntil: "domcontentloaded" });
  await injectExtractor(page);

  const full = await observeFull(page);
  const fileFields = full
    .flatMap((form) => form.fields)
    .filter((field) => field.kind === "file");

  expect(fileFields).toEqual([]);
});

test("aai-more.html recognises common personal, address and bank fields", async ({
  page,
}) => {
  await page.goto("/aai-more.html", { waitUntil: "domcontentloaded" });
  await injectExtractor(page);

  const full = await observeFull(page);
  const fields = full[0]?.fields ?? [];
  const conceptsByName = new Map(
    fields.map((field) => [
      field.name,
      resolveMatch(field, ontology).candidates[0]?.conceptKey,
    ]),
  );

  expect(conceptsByName.get("opt_cat")).toBe("identity.category");
  expect(conceptsByName.get("are_you_indian")).toBe("identity.nationality");
  expect(conceptsByName.get("optsex")).toBe("identity.gender");
  expect(conceptsByName.get("mstatus")).toBe("identity.marital_status");
  expect(conceptsByName.get("spousefirstname")).toBe("identity.spouse_name");
  expect(conceptsByName.get("txtaddress3")).toBe("contact.address.line3");
  expect(conceptsByName.get("txtdistrict")).toBe("contact.address.district");
  expect(conceptsByName.get("account_holder_name")).toBe(
    "bank.account_holder_name",
  );
  expect(conceptsByName.get("bankaccno")).toBe("bank.account_number");
  expect(conceptsByName.get("c_acc_no")).toBe("bank.account_number");
  expect(conceptsByName.get("bank_branch")).toBe("bank.branch_name");
  expect(conceptsByName.get("type_of_account")).toBe("bank.account_type");
});

test("supabase.html extracts a form-like ATS application container", async ({
  page,
}) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "localhost"
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await page.goto("/supabase.html", { waitUntil: "domcontentloaded" });
  await injectExtractor(page);

  const full = await observeFull(page);
  const fields = full[0]?.fields ?? [];
  const fieldByLabel = new Map(fields.map((field) => [field.label, field]));
  const conceptByLabel = new Map(
    fields.map((field) => [
      field.label,
      resolveMatch(field, ontology).candidates[0]?.conceptKey,
    ]),
  );

  expect(full).toHaveLength(1);
  expect(full[0]?.submitLabel).toBe("Submit Application");
  expect(fields).toHaveLength(12);

  expect(fieldByLabel.get("Name")?.kind).toBe("text");
  expect(conceptByLabel.get("Name")).toBe("identity.full_name");
  expect(fieldByLabel.get("Email")?.kind).toBe("email");
  expect(conceptByLabel.get("Email")).toBe("contact.email");

  const resume = fieldByLabel.get("Resume");
  expect(resume?.kind).toBe("file");
  expect(resume?.required).toBe(true);
  expect(resume?.name).toBeUndefined();
  expect(resume?.constraints).toContainEqual({
    kind: "accept",
    value: expect.arrayContaining([".pdf", ".docx"]),
  });
  expect(conceptByLabel.get("Resume")).toBe("documents.resume");

  expect(conceptByLabel.get("Passport Country")).toBe(
    "contact.address.country",
  );
  expect(conceptByLabel.get("Country of Residence")).toBe(
    "contact.address.country",
  );
  expect(conceptByLabel.get("Twitter / X profile")).toBe("contact.twitter_url");
  expect(conceptByLabel.get("Github Profile")).toBe("contact.github_url");
  expect(conceptByLabel.get("Linkedin")).toBe("contact.linkedin_url");
});

test("GATE.html extracts Material-style application fields as known concepts", async ({
  page,
}) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "localhost"
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await page.goto("/GATE.html", { waitUntil: "domcontentloaded" });
  await injectExtractor(page);

  const full = await observeFull(page);
  const fields = full[0]?.fields ?? [];
  const conceptKeys = new Set(
    fields
      .map((field) => resolveMatch(field, ontology).candidates[0]?.conceptKey)
      .filter(Boolean),
  );

  expect(fields.length).toBeGreaterThan(0);
  expect([...conceptKeys]).toEqual(
    expect.arrayContaining([
      "identity.nationality",
      "identity.category",
      "identity.disability_status",
    ]),
  );
  const uploadIntents = full[0]?.uploadIntents ?? [];
  expect(uploadIntents.map((intent) => intent.kind)).toEqual(
    expect.arrayContaining(["photo", "signature"]),
  );
  expect(uploadIntents.every((intent) => !intent.hasNativeTarget)).toBe(true);
});

test("custom upload controls expose requirements without becoming fillable fields", async ({
  page,
}) => {
  await page.setContent(`
    <form>
      <section>
        <button type="button">Upload Photograph</button>
        <p>Upload JPEG/JPG/PNG with minimum pixel resolution 200 x 260 and maximum pixel resolution 530 x 690. File size should be between 5 KB and 600 KB.</p>
      </section>
      <section>
        <button type="button">Upload Signature</button>
        <p>Upload JPEG/JPG file with minimum pixel resolution 250 x 80 and maximum pixel resolution 580 x 180. Aspect ratio 1 : R must be between 2.75 and 3.75.</p>
      </section>
    </form>
  `);
  await injectExtractor(page);

  const form = (await observeFull(page))[0];
  const intents = form?.uploadIntents ?? [];
  expect(form?.fields).toEqual([]);
  expect(intents.map((intent) => intent.kind)).toEqual(["photo", "signature"]);
  expect(intents[0]?.actionability).toBe("user_assisted");
  expect(intents[0]?.constraints).toEqual(
    expect.arrayContaining([
      { kind: "dimensions", bound: "min", value: { width: 200, height: 260 } },
      { kind: "dimensions", bound: "max", value: { width: 530, height: 690 } },
      { kind: "fileSizeRangeBytes", value: { min: 5120, max: 614400 } },
    ]),
  );
  expect(intents[1]?.constraints).toEqual(
    expect.arrayContaining([
      { kind: "aspectRatio", value: { min: 2.75, max: 3.75 } },
    ]),
  );
});

test("extracting a 500-field page stays within budget", async ({ page }) => {
  const inputs = Array.from(
    { length: 500 },
    (_, i) =>
      `<label for="f${i}">Field ${i}</label><input id="f${i}" name="f${i}" />`,
  ).join("\n");
  await page.setContent(`<form>${inputs}</form>`);
  await injectExtractor(page);

  const durationMs = await page.evaluate(() => {
    const extract = window.__formAgentExtract;
    if (!extract) throw new Error("extractor did not attach to window");
    const start = performance.now();
    extract();
    return performance.now() - start;
  });

  // Generous headroom over local measurements (see the phase 1a handback
  // for the recorded number) so ordinary CI jitter does not make this flaky.
  expect(durationMs).toBeLessThan(250);
});
