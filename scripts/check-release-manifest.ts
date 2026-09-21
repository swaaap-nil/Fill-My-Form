import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Fails the build if the de-starter is ever partially reverted. Each rule
 * here corresponds to a specific starter behaviour that must never come
 * back: all-sites access, a hijacked new-tab page, a background sweep, or
 * the starter's own copy and icon slipping back into the bundle.
 *
 * `evaluateManifest` is the pure, unit-testable core. Everything else here
 * is I/O: reading the built manifest and scanning `build/` on disk.
 */

const BUILD_DIR = "build";
const TARGET_MANIFESTS = [
  { target: "chrome", path: `${BUILD_DIR}/chrome-mv3/manifest.json` },
  { target: "firefox", path: `${BUILD_DIR}/firefox-mv3/manifest.json` },
] as const;

type TargetBrowser = (typeof TARGET_MANIFESTS)[number]["target"];

/** The vendored `turbostarter/extro` icon this repo shipped with at import. */
export const VENDORED_EXTRO_ICON_SHA256 =
  "0b779261339b1fbf648df46422626705d8d3b67490d6f86a87b088620582ec38";

const BANNED_STRINGS = ["turbostarter", "extro", "Hello from"] as const;

const TEXT_EXTENSIONS = [
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".map",
];

export interface ManifestLike {
  readonly manifest_version?: unknown;
  readonly host_permissions?: unknown;
  readonly optional_host_permissions?: readonly unknown[];
  readonly chrome_url_overrides?: unknown;
  readonly devtools_page?: unknown;
  readonly content_scripts?: unknown;
  readonly permissions?: readonly unknown[];
  readonly action?: {
    readonly default_popup?: unknown;
  };
  readonly browser_action?: {
    readonly default_popup?: unknown;
  };
  readonly side_panel?: {
    readonly default_path?: unknown;
  };
  readonly sidebar_action?: {
    readonly default_panel?: unknown;
  };
  readonly browser_specific_settings?: {
    readonly gecko?: {
      readonly id?: unknown;
      readonly strict_min_version?: unknown;
    };
  };
  readonly content_security_policy?: {
    readonly extension_pages?: string;
  };
}

/**
 * Checks the manifest-shaped rules only. Rules that need the build
 * filesystem (banned strings, icon hash) are checked separately by
 * `scanBuildDirectory`, since a synthetic manifest can't stand in for them.
 */
export const evaluateManifest = (manifest: ManifestLike): string[] => {
  const findings: string[] = [];

  if (manifest.host_permissions !== undefined) {
    findings.push(
      "host_permissions is present — this is the install-time all-sites grant. See wxt.config.ts's build:manifestGenerated hook.",
    );
  }

  if (manifest.chrome_url_overrides !== undefined) {
    findings.push(
      "chrome_url_overrides is present — an entrypoint that overrides a browser page (e.g. new tab) survived de-starter.",
    );
  }

  if (manifest.devtools_page !== undefined) {
    findings.push(
      "devtools_page is present — the starter's devtools panel survived de-starter.",
    );
  }

  if (
    Array.isArray(manifest.content_scripts) &&
    manifest.content_scripts.length > 0
  ) {
    findings.push(
      "content_scripts is non-empty — the content script must register at runtime for a granted origin only, never declaratively in the manifest.",
    );
  }

  const csp = manifest.content_security_policy?.extension_pages ?? "";
  if (!csp.includes("script-src 'self'")) {
    findings.push("CSP is missing script-src 'self'.");
  }
  for (const forbidden of ["unsafe-eval", "unsafe-inline", "frame-ancestors"]) {
    if (csp.includes(forbidden)) {
      findings.push(`CSP contains forbidden directive/keyword: ${forbidden}.`);
    }
  }

  if (manifest.permissions?.includes("alarms")) {
    findings.push(
      "alarms is in permissions — ADR 006 forbids a background sweep; freshness is evaluated on read.",
    );
  }

  const manifestString = JSON.stringify(manifest);
  if (manifestString.includes("localhost")) {
    findings.push("localhost appears in the manifest.");
  }

  return findings;
};

const includesAll = (
  values: readonly unknown[] | undefined,
  expected: readonly string[],
): boolean => expected.every((value) => values?.includes(value));

const requirePermissions = (
  manifest: ManifestLike,
  expected: readonly string[],
): string[] =>
  expected.flatMap((permission) =>
    manifest.permissions?.includes(permission)
      ? []
      : [`permissions is missing ${permission}.`],
  );

export const evaluateTargetManifest = (
  target: TargetBrowser,
  manifest: ManifestLike,
): string[] => {
  const findings = evaluateManifest(manifest);

  if (target === "firefox") {
    findings.push(
      ...requirePermissions(manifest, [
        "storage",
        "activeTab",
        "tabs",
        "scripting",
        "notifications",
      ]),
    );

    if (manifest.manifest_version !== 3) {
      findings.push("Firefox manifest_version must be 3.");
    }

    if (
      !includesAll(manifest.optional_host_permissions, [
        "https://*/*",
        "http://*/*",
      ])
    ) {
      findings.push(
        "Firefox optional_host_permissions must include https://*/* and http://*/*.",
      );
    }

    if (manifest.permissions?.includes("sidePanel")) {
      findings.push(
        "Firefox permissions contains sidePanel — Firefox uses sidebar_action and AMO flags sidePanel as invalid.",
      );
    }

    const gecko = manifest.browser_specific_settings?.gecko;
    if (typeof gecko?.id !== "string" || gecko.id.length === 0) {
      findings.push("Firefox browser_specific_settings.gecko.id is missing.");
    }
    if (
      typeof gecko?.strict_min_version !== "string" ||
      gecko.strict_min_version.length === 0
    ) {
      findings.push(
        "Firefox browser_specific_settings.gecko.strict_min_version is missing.",
      );
    }

    if (manifest.browser_action?.default_popup !== undefined) {
      findings.push(
        "Firefox browser_action.default_popup is present — the deleted popup must not come back.",
      );
    }

    if (manifest.sidebar_action?.default_panel !== "sidepanel.html") {
      findings.push(
        "Firefox sidebar_action.default_panel must point at sidepanel.html.",
      );
    }
  }

  if (target === "chrome") {
    findings.push(
      ...requirePermissions(manifest, [
        "storage",
        "sidePanel",
        "activeTab",
        "tabs",
        "scripting",
        "notifications",
      ]),
    );

    if (manifest.manifest_version !== 3) {
      findings.push("Chrome manifest_version must be 3.");
    }

    if (manifest.action?.default_popup !== undefined) {
      findings.push(
        "Chrome action.default_popup is present — the toolbar icon must open the side panel, not a popup.",
      );
    }

    if (manifest.side_panel?.default_path !== "sidepanel.html") {
      findings.push(
        "Chrome side_panel.default_path must point at sidepanel.html.",
      );
    }

    if (
      !includesAll(manifest.optional_host_permissions, [
        "https://*/*",
        "http://*/*",
      ])
    ) {
      findings.push(
        "Chrome optional_host_permissions must include https://*/* and http://*/*.",
      );
    }
  }

  return findings;
};

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return [path];
    }),
  );
  return files.flat();
};

export const scanBuildDirectory = async (
  buildDir: string,
): Promise<string[]> => {
  const findings: string[] = [];
  const files = await walk(buildDir);

  const textFiles = files.filter((path) =>
    TEXT_EXTENSIONS.some((ext) => path.endsWith(ext)),
  );
  for (const path of textFiles) {
    const contents = await Bun.file(path).text();
    for (const banned of BANNED_STRINGS) {
      if (contents.includes(banned)) {
        findings.push(`${path}: contains banned string "${banned}"`);
      }
    }
  }

  const iconPath = files.find((path) => path.endsWith("icon.png"));
  if (iconPath) {
    const hash = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(iconPath).arrayBuffer())
      .digest("hex");
    if (hash === VENDORED_EXTRO_ICON_SHA256) {
      findings.push(
        `${iconPath}: sha256 matches the vendored Extro icon — the product icon was never replaced.`,
      );
    }
  }

  return findings;
};

if (import.meta.main) {
  const findings: string[] = [];

  for (const { target, path } of TARGET_MANIFESTS) {
    const manifestFile = Bun.file(path);
    if (!(await manifestFile.exists())) {
      console.error(`No ${path}. Run \`bun run build\` first.`);
      process.exit(1);
    }

    const manifest = (await manifestFile.json()) as ManifestLike;
    findings.push(
      ...evaluateTargetManifest(target, manifest).map(
        (finding) => `${path}: ${finding}`,
      ),
    );
  }

  findings.push(...(await scanBuildDirectory(BUILD_DIR)));

  if (findings.length > 0) {
    console.error("Release manifest check failed:");
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }

  console.log("Release manifest check passed.");
}
