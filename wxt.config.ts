import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type WxtViteConfig } from "wxt";
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

export default defineConfig({
  manifest: {
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    default_locale: "en",

    // The floor for the `sidePanel` API, which the toolbar icon depends on.
    minimum_chrome_version: "114",

    /**
     * No `default_popup`: with one set, Chrome opens the popup on click and
     * `openPanelOnActionClick` is ignored. The side panel is this product's
     * surface, so the icon opens that instead — see `src/app/background`.
     */
    action: { default_title: "__MSG_extensionName__" },

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
    permissions: ["storage", "sidePanel", "activeTab", "scripting"],
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
  },
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
        /**
         * In dev, WXT serves every script from this Vite server and the
         * extension pages fetch them from a `chrome-extension://` origin.
         * Vite 8 blocks cross-origin requests by default, so without this the
         * side panel loads no JavaScript and renders as a blank white panel
         * with only a CORS error in its console.
         *
         * Scoped to extension origins rather than `true`: this server also
         * serves source files, and a page you visit while developing should
         * not be able to read them.
         */
        cors: { origin: /^chrome-extension:\/\// },
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
