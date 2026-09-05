/**
 * The pure core of `wxt.config.ts`'s `build:manifestGenerated` hook.
 *
 * Extracted so it is unit-testable under `bun test` without a real build:
 * `wxt.config.ts` stays a thin wrapper that passes it `process.env`, one of
 * the very few places this repo needs to.
 */

export interface HostPermissionsManifest {
  host_permissions?: unknown;
}

/**
 * Strips WXT's inferred `host_permissions` — the install-time all-sites
 * grant this product deliberately does not make — except under
 * `WXT_E2E=1`, where Playwright cannot click Chrome's native permission
 * bubble and so needs `localhost:4173` (the fixture site) pre-granted.
 *
 * That flag only ever adds `localhost`, never `<all_urls>`, and
 * `scripts/check-release-manifest.ts` fails any build with
 * `host_permissions` present at all — `WXT_E2E` or not — so this cannot
 * leak into a release build even if the flag is set by mistake.
 */
export const applyHostPermissionsPolicy = (
  manifest: HostPermissionsManifest,
  env: Readonly<Record<string, string | undefined>>,
): void => {
  delete manifest.host_permissions;

  if (env.WXT_E2E === "1") {
    manifest.host_permissions = ["http://localhost:4173/*"];
  }
};
