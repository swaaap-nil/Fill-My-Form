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
const MANIFEST_PATH = `${BUILD_DIR}/chrome-mv3/manifest.json`;

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
  readonly host_permissions?: unknown;
  readonly chrome_url_overrides?: unknown;
  readonly devtools_page?: unknown;
  readonly content_scripts?: unknown;
  readonly permissions?: readonly unknown[];
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
  const manifestFile = Bun.file(MANIFEST_PATH);
  if (!(await manifestFile.exists())) {
    console.error(`No ${MANIFEST_PATH}. Run \`bun run build:chrome\` first.`);
    process.exit(1);
  }

  const manifest = (await manifestFile.json()) as ManifestLike;
  const findings = [
    ...evaluateManifest(manifest),
    ...(await scanBuildDirectory(BUILD_DIR)),
  ];

  if (findings.length > 0) {
    console.error("Release manifest check failed:");
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }

  console.log("Release manifest check passed.");
}
