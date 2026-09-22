import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type WxtViteConfig } from "wxt";
import { EXTENSION_ORIGIN_PATTERN } from "./scripts/dev-server-cors";
import { applyHostPermissionsPolicy } from "./scripts/manifest-hook";

/**
 * Persistent dev profile. `chrome-launcher` writes its log here on startup and
 * does not create the directory itself, so make it up front or `bun dev`
 * fails with ENOENT before the browser ever opens.
 */
const DEV_PROFILE = resolve(".chrome-profile");
const USE_FRESH_PROFILE = process.env.WXT_DEV_FRESH_PROFILE === "1";

if (!USE_FRESH_PROFILE) {
  mkdirSync(DEV_PROFILE, { recursive: true });
}

/**
 * Chrome derives an unpacked extension's id from the absolute path it was
 * loaded from. `build/chrome-mv3-dev` is usually that same path every run,
 * but anything that changes it (a different clone location, `build/` wiped
 * and rebuilt at a differently-cased path, CI vs. local) mints a new id —
 * and with it a new `chrome-extension://<id>/` origin, which orphans the
 * IndexedDB store `src/lib/indexeddb-local-data.ts` writes memory into. The
 * `.chrome-profile` persists fine; it just ends up holding data under an id
 * nothing points at anymore.
 *
 * Manifest V3's `key` field pins the id instead of deriving it, so dev
 * memory survives regardless of path. This is a public key with no matching
 * private key kept anywhere, so it carries no secret and is safe to commit.
 * Dev-only: a packaged store build must not set `key` (the store assigns
 * its own id).
 *
 * Chrome-only: Firefox doesn't derive its dev id from the load path in the
 * first place — `browser_specific_settings.gecko.id` below already pins it,
 * in both dev and release. Firefox ignores an unknown `key` field, but
 * there's nothing for it to fix there.
 */
const DEV_EXTENSION_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuyd+SX6kWhsNifAiaZy+RaFzKM6HduroNDYAiT+c1QufmE9HxBV2lFl8mo8qD6bSPg10V22IA+pxk/yXtm4Y8dadHJYM7CmCUtNPGHb7l1tMKVwCIRRqFLAAMUR7sM49jZgaqMYukSxge6D9mcRCpXF5OooDx5ye6+Jjq+B3iageKCMLHNbyGxluHeAnT6SHoxSQr/TAPlqZn6vbFussKMIGXQu0n/FG8Kn2ZjX1bNwwecd4Sun0ZF1bcgFjppOdjs3e795eaYQKBn41c67sDSDCeU886MFbVLoybb5lDdzr2QvVo8tArXANeBJkZH91NJCwAdOYjr/bRIMuCkPOUwIDAQAB";

export default defineConfig({
  manifestVersion: 3,
  manifest: (env) => ({
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    default_locale: "en",
    ...(env.command === "serve" && env.browser !== "firefox"
      ? { key: DEV_EXTENSION_PUBLIC_KEY }
      : {}),

    // The floor for the `sidePanel` API, which the toolbar icon depends on.
    minimum_chrome_version: "114",

    /**
     * No `default_popup`: with one set, Chrome opens the popup on click and
     * `openPanelOnActionClick` is ignored. The side panel is this product's
     * surface, so the icon opens that instead — see `src/app/background`.
     */
    action: { default_title: "__MSG_extensionName__" },

    /**
     * Firefox requires (MV3) or strongly recommends (MV2) a stable add-on
     * id independent of the store-assigned numeric one, so a future update
     * is recognised as the same add-on rather than a new listing.
     * Chrome-only builds omit the key entirely rather than relying on
     * Chrome to ignore it — a Firefox-specific key has no reason to be in
     * a Chrome manifest at all. The email-shaped value is Mozilla's own
     * documented convention — it does not need to be a real, receiving
     * address, and is public (visible in the manifest and the AMO
     * listing), same as any other extension id.
     *
     * `data_collection_permissions.required` is mandatory for new
     * extensions from November 3, 2025 — not a warning to suppress.
     *
     * TODO(before next Firefox submission): this is stale. `["none"]` was
     * honest when the extension made no network requests of its own, but
     * ADR 010 wires an optional, on-by-default, anonymous analytics client
     * (OpenPanel). Update this to the correct AMO data-collection category
     * (verify against Mozilla's current taxonomy at submission time — see
     * docs/adr/010-product-analytics.md and docs/privacy.md) before the next
     * `submit:firefox` run, and update the AMO listing's own disclosure to
     * match. Left as "none" for now so this isn't silently wrong in a
     * direction nobody reviewed.
     */
    ...(env.browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: "ff@swapnilsuman.me",
          strict_min_version: "109.0",
          data_collection_permissions: { required: ["none"] },
        },
      },
    }),

    /**
     * Site access is NOT granted at install time.
     *
     * `activeTab` gives us the current tab only after the user invokes the
     * extension, and anything broader has to be granted per-site through
     * `optional_host_permissions` at runtime. A form agent reads personal
     * data off arbitrary pages; a blanket `<all_urls>` host permission would
     * make that grant invisible to the user and is the wrong default for a
     * privacy-first product. See docs/privacy.md.
     */
    permissions: [
      "storage",
      ...(env.browser === "firefox" ? [] : ["sidePanel"]),
      "activeTab",
      "tabs",
      "scripting",
      "notifications",
    ],
    optional_host_permissions: ["https://*/*", "http://*/*"],

    /**
     * No `unsafe-eval`, no remote script. The extension must run only code
     * that shipped in the bundle: model output is untrusted input and must
     * never become executable. See docs/privacy.md.
     *
     * Do NOT add `frame-ancestors 'none'` here. Chrome renders the side panel
     * by embedding the extension page in a frame, so that directive silently
     * blanks the panel — it opens and renders nothing, which reads as the
     * button being broken. It also buys nothing: web pages already cannot
     * frame extension pages unless the page is listed in
     * `web_accessible_resources`, and none of ours are.
     * Guarded by an e2e test.
     */
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  }),
  srcDir: "src",
  entrypointsDir: "app",
  /**
   * A `WXT_E2E=1` build carries a `host_permissions` entry (see the
   * `build:manifestGenerated` hook below) that a release build must never
   * have. Separate output directories, rather than one directory rebuilt
   * twice, mean `e2e/fill.spec.ts` and every other e2e spec can load their
   * own build without one clobbering the other's manifest.
   */
  outDir: process.env.WXT_E2E === "1" ? "build-e2e" : "build",
  modules: ["@wxt-dev/module-react", "@wxt-dev/auto-icons"],
  imports: false,
  vite: () =>
    ({
      plugins: [tailwindcss()],
      server: {
        // See `scripts/dev-server-cors.ts` for why this is scoped the way it is.
        cors: { origin: EXTENSION_ORIGIN_PATTERN },
      },

      /**
       * Vite's dependency scanner globs every HTML file it can find, which
       * here means the fixture site and previous build output. It then fails
       * to resolve them, prints a wall of UNRESOLVED_ENTRY errors and skips
       * pre-bundling entirely. Point it at the real entrypoints instead.
       */
      optimizeDeps: {
        entries: ["src/app/**/*.html"],
      },
    }) as WxtViteConfig,
  hooks: {
    /**
     * WXT infers `host_permissions` from a runtime-registered content
     * script's `matches`, which would reintroduce the install-time
     * all-sites grant we deliberately dropped. Setting `host_permissions: []`
     * in `manifest` above is not enough — the inference runs afterwards — so
     * strip it here, at the last point before the manifest is written.
     *
     * The content script gets its host access at runtime instead, from
     * `optional_host_permissions` via `permissions.request()`. If this hook
     * is ever removed, `chrome://extensions` will silently start saying
     * "on all sites". See docs/privacy.md.
     *
     * `WXT_E2E=1` is the one exception, and a narrow one: Playwright cannot
     * click Chrome's native permission bubble, so `e2e/fill.spec.ts` needs
     * `localhost:4173` (the fixture site) pre-granted to exercise the fill
     * flow without that click. This still owns host permissions in one
     * place — the flag only ever adds `localhost`, never `<all_urls>` — and
     * `scripts/check-release-manifest.ts` fails any build, `WXT_E2E` or
     * not, that has `host_permissions` at all, so the flag cannot leak into
     * a release build even if someone sets it by mistake. The policy itself
     * is `scripts/manifest-hook.ts`, unit-tested there.
     */
    "build:manifestGenerated": (_wxt, manifest) => {
      applyHostPermissionsPolicy(
        manifest as { host_permissions?: unknown },
        process.env,
      );
    },
  },
  webExt: {
    chromiumArgs: ["--disable-features=DisableLoadExtensionCommandLineSwitch"],

    /**
     * A persistent dev profile, so pinning the extension to the toolbar (and
     * any site access you grant) survives a restart of `bun dev`. Chrome has
     * no way for an extension to pin itself; with a throwaway profile you
     * would re-pin on every run.
     *
     * Gitignored. Delete `.chrome-profile/` to start clean.
     */
    ...(USE_FRESH_PROFILE
      ? {}
      : { chromiumProfile: DEV_PROFILE, keepProfileChanges: true }),
  },
});
