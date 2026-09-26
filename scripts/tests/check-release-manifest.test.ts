import { afterEach, describe, expect, it } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateManifest,
  evaluatePermissionBaseline,
  evaluateTargetManifest,
  type ManifestLike,
  type PermissionBaseline,
  scanBuildDirectory,
} from "../check-release-manifest";

const VENDORED_ICON_FIXTURE = join(
  import.meta.dir,
  "fixtures/vendored-extro-icon.png",
);

const CLEAN_MANIFEST: ManifestLike = {
  manifest_version: 3,
  permissions: [
    "storage",
    "sidePanel",
    "activeTab",
    "tabs",
    "scripting",
    "notifications",
  ],
  optional_host_permissions: ["https://*/*", "http://*/*"],
  content_scripts: [],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
};

const CLEAN_CHROME_MANIFEST: ManifestLike = {
  ...CLEAN_MANIFEST,
  action: { default_popup: undefined },
  side_panel: { default_path: "sidepanel.html" },
};

const CLEAN_FIREFOX_MANIFEST: ManifestLike = {
  ...CLEAN_MANIFEST,
  permissions: ["storage", "activeTab", "tabs", "scripting", "notifications"],
  browser_specific_settings: {
    gecko: {
      id: "ff@swapnilsuman.me",
      strict_min_version: "109.0",
    },
  },
  sidebar_action: { default_panel: "sidepanel.html" },
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

describe("evaluateTargetManifest", () => {
  it("passes a clean Chrome manifest", () => {
    expect(evaluateTargetManifest("chrome", CLEAN_CHROME_MANIFEST)).toEqual([]);
  });

  it("passes a clean Firefox MV3 manifest", () => {
    expect(evaluateTargetManifest("firefox", CLEAN_FIREFOX_MANIFEST)).toEqual(
      [],
    );
  });

  it("fails when the Firefox manifest is not MV3", () => {
    const findings = evaluateTargetManifest("firefox", {
      ...CLEAN_FIREFOX_MANIFEST,
      manifest_version: 2,
    });

    expect(findings.some((f) => f.includes("manifest_version"))).toBe(true);
  });

  it("fails when Firefox optional host permissions are missing", () => {
    const findings = evaluateTargetManifest("firefox", {
      ...CLEAN_FIREFOX_MANIFEST,
      optional_host_permissions: ["https://*/*"],
    });

    expect(findings.some((f) => f.includes("optional_host_permissions"))).toBe(
      true,
    );
  });

  it("fails when Firefox contains Chrome's sidePanel permission", () => {
    const findings = evaluateTargetManifest("firefox", {
      ...CLEAN_FIREFOX_MANIFEST,
      permissions: ["storage", "sidePanel", "activeTab", "tabs", "scripting"],
    });

    expect(findings.some((f) => f.includes("sidePanel"))).toBe(true);
  });

  it("fails when Chrome is missing tabs permission", () => {
    const findings = evaluateTargetManifest("chrome", {
      ...CLEAN_CHROME_MANIFEST,
      permissions: ["storage", "sidePanel", "activeTab", "scripting"],
    });

    expect(findings.some((f) => f.includes("tabs"))).toBe(true);
  });

  it("fails when Chrome optional host permissions are missing", () => {
    const findings = evaluateTargetManifest("chrome", {
      ...CLEAN_CHROME_MANIFEST,
      optional_host_permissions: ["https://*/*"],
    });

    expect(findings.some((f) => f.includes("optional_host_permissions"))).toBe(
      true,
    );
  });

  it("fails when Firefox has no Gecko id", () => {
    const findings = evaluateTargetManifest("firefox", {
      ...CLEAN_FIREFOX_MANIFEST,
      browser_specific_settings: {
        gecko: { strict_min_version: "109.0" },
      },
    });

    expect(findings.some((f) => f.includes("gecko.id"))).toBe(true);
  });

  it("fails when Firefox has no strict minimum Gecko version", () => {
    const findings = evaluateTargetManifest("firefox", {
      ...CLEAN_FIREFOX_MANIFEST,
      browser_specific_settings: {
        gecko: { id: "ff@swapnilsuman.me" },
      },
    });

    expect(findings.some((f) => f.includes("strict_min_version"))).toBe(true);
  });

  it("fails when Firefox browser_action points at a popup", () => {
    const findings = evaluateTargetManifest("firefox", {
      ...CLEAN_FIREFOX_MANIFEST,
      browser_action: { default_popup: "popup.html" },
    });

    expect(findings.some((f) => f.includes("default_popup"))).toBe(true);
  });

  it("fails when Firefox sidebar_action does not point at the side panel", () => {
    const findings = evaluateTargetManifest("firefox", {
      ...CLEAN_FIREFOX_MANIFEST,
      sidebar_action: { default_panel: "wrong.html" },
    });

    expect(findings.some((f) => f.includes("sidebar_action"))).toBe(true);
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

  it("fails when Firefox content CSS contains host-page selectors", async () => {
    dir = await mkdtemp(join(tmpdir(), "release-manifest-firefox-css-"));
    const cssDir = join(dir, "firefox-mv3", "content-scripts");
    await mkdir(cssDir, { recursive: true });
    await writeFile(
      join(cssDir, "content.css"),
      "@layer base{body{background:red}button,input,select,optgroup,textarea{font:inherit}}",
    );

    const findings = await scanBuildDirectory(dir);
    expect(findings.some((f) => f.includes('global selector "body"'))).toBe(
      true,
    );
    expect(
      findings.some((f) =>
        f.includes('global selector "button/input/textarea"'),
      ),
    ).toBe(true);
  });

  it("passes when Firefox content CSS is scoped to the extension UI", async () => {
    dir = await mkdtemp(join(tmpdir(), "release-manifest-firefox-css-ok-"));
    const cssDir = join(dir, "firefox-mv3", "content-scripts");
    await mkdir(cssDir, { recursive: true });
    await writeFile(
      join(cssDir, "content.css"),
      "form-agent-ui{all:initial}.fill-my-form-banner{position:fixed}",
    );

    expect(await scanBuildDirectory(dir)).toEqual([]);
  });
});

describe("evaluatePermissionBaseline", () => {
  const BASELINE: PermissionBaseline = {
    chrome: { permissions: ["storage", "tabs"] },
    firefox: { permissions: ["storage"] },
  };

  it("passes when required permissions match the baseline", () => {
    expect(
      evaluatePermissionBaseline(
        "chrome",
        { permissions: ["storage", "tabs"] },
        BASELINE,
      ),
    ).toEqual([]);
  });

  it("fails when a required permission is not in the baseline", () => {
    const findings = evaluatePermissionBaseline(
      "chrome",
      { permissions: ["storage", "tabs", "somethingNew"] },
      BASELINE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("somethingNew");
    expect(findings[0]).toContain("re-approve");
  });

  it("allows permissions to be removed", () => {
    expect(
      evaluatePermissionBaseline(
        "chrome",
        { permissions: ["storage"] },
        BASELINE,
      ),
    ).toEqual([]);
  });

  it("fails on any host_permissions", () => {
    const findings = evaluatePermissionBaseline(
      "chrome",
      { permissions: ["storage"], host_permissions: [] },
      BASELINE,
    );
    expect(findings.some((f) => f.includes("host_permissions"))).toBe(true);
  });

  it("keeps each target's baseline independent", () => {
    const findings = evaluatePermissionBaseline(
      "firefox",
      { permissions: ["storage", "tabs"] },
      BASELINE,
    );
    expect(findings.some((f) => f.includes("tabs"))).toBe(true);
  });

  it("is applied by evaluateTargetManifest", () => {
    const findings = evaluateTargetManifest("chrome", {
      ...CLEAN_CHROME_MANIFEST,
      permissions: [...(CLEAN_CHROME_MANIFEST.permissions ?? []), "history"],
    });
    expect(findings.some((f) => f.includes("history"))).toBe(true);
  });
});
