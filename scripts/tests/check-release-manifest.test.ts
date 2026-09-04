import { afterEach, describe, expect, it } from "bun:test";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateManifest,
  type ManifestLike,
  scanBuildDirectory,
} from "../check-release-manifest";

const VENDORED_ICON_FIXTURE = join(
  import.meta.dir,
  "fixtures/vendored-extro-icon.png",
);

const CLEAN_MANIFEST: ManifestLike = {
  permissions: ["storage", "sidePanel", "activeTab", "scripting"],
  content_scripts: [],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
};

describe("evaluateManifest", () => {
  it("passes a clean manifest", () => {
    expect(evaluateManifest(CLEAN_MANIFEST)).toEqual([]);
  });

  it("fails when host_permissions is present", () => {
    const findings = evaluateManifest({
      ...CLEAN_MANIFEST,
      host_permissions: ["https://*/*"],
    });
    expect(findings.some((f) => f.includes("host_permissions"))).toBe(true);
  });

  it("fails when chrome_url_overrides is present", () => {
    const findings = evaluateManifest({
      ...CLEAN_MANIFEST,
      chrome_url_overrides: { newtab: "newtab.html" },
    });
    expect(findings.some((f) => f.includes("chrome_url_overrides"))).toBe(true);
  });

  it("fails when devtools_page is present", () => {
    const findings = evaluateManifest({
      ...CLEAN_MANIFEST,
      devtools_page: "devtools.html",
    });
    expect(findings.some((f) => f.includes("devtools_page"))).toBe(true);
  });

  it("fails when content_scripts is non-empty", () => {
    const findings = evaluateManifest({
      ...CLEAN_MANIFEST,
      content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"] }],
    });
    expect(findings.some((f) => f.includes("content_scripts"))).toBe(true);
  });

  it("fails when the CSP is missing script-src 'self'", () => {
    const findings = evaluateManifest({
      ...CLEAN_MANIFEST,
      content_security_policy: { extension_pages: "object-src 'self'" },
    });
    expect(findings.some((f) => f.includes("script-src 'self'"))).toBe(true);
  });

  for (const keyword of ["unsafe-eval", "unsafe-inline", "frame-ancestors"]) {
    it(`fails when the CSP contains ${keyword}`, () => {
      const findings = evaluateManifest({
        ...CLEAN_MANIFEST,
        content_security_policy: {
          extension_pages: `script-src 'self' ${keyword}`,
        },
      });
      expect(findings.some((f) => f.includes(keyword))).toBe(true);
    });
  }

  it("fails when alarms is in permissions", () => {
    const findings = evaluateManifest({
      ...CLEAN_MANIFEST,
      permissions: ["storage", "alarms"],
    });
    expect(findings.some((f) => f.includes("alarms"))).toBe(true);
  });

  it("fails when localhost appears anywhere in the manifest", () => {
    const findings = evaluateManifest({
      ...CLEAN_MANIFEST,
      content_security_policy: {
        extension_pages: "script-src 'self' http://localhost:5173",
      },
    });
    expect(findings.some((f) => f.includes("localhost"))).toBe(true);
  });
});

describe("scanBuildDirectory", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("passes a clean build directory", async () => {
    dir = await mkdtemp(join(tmpdir(), "release-manifest-clean-"));
    await writeFile(join(dir, "background.js"), "console.log('ok')");

    expect(await scanBuildDirectory(dir)).toEqual([]);
  });

  for (const banned of ["turbostarter", "extro", "Hello from"]) {
    it(`fails when "${banned}" appears in build output`, async () => {
      dir = await mkdtemp(join(tmpdir(), "release-manifest-banned-"));
      await writeFile(join(dir, "sidepanel.js"), `// ${banned} lives here`);

      const findings = await scanBuildDirectory(dir);
      expect(findings.some((f) => f.includes(banned))).toBe(true);
    });
  }

  it("fails when the bundled icon matches the vendored Extro icon's hash", async () => {
    dir = await mkdtemp(join(tmpdir(), "release-manifest-icon-"));
    await copyFile(VENDORED_ICON_FIXTURE, join(dir, "icon.png"));

    const findings = await scanBuildDirectory(dir);
    expect(findings.some((f) => f.includes("vendored Extro icon"))).toBe(true);
  });

  it("passes when the bundled icon differs from the vendored Extro icon", async () => {
    dir = await mkdtemp(join(tmpdir(), "release-manifest-icon-ok-"));
    await writeFile(join(dir, "icon.png"), new Uint8Array(32).fill(7));

    expect(await scanBuildDirectory(dir)).toEqual([]);
  });
});
