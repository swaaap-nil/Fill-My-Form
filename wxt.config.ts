import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type WxtViteConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    default_locale: "en",

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
     */
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; frame-ancestors 'none'",
    },
  },
  srcDir: "src",
  entrypointsDir: "app",
  outDir: "build",
  modules: ["@wxt-dev/module-react", "@wxt-dev/auto-icons"],
  imports: false,
  vite: () =>
    ({
      plugins: [tailwindcss()],
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
     */
    "build:manifestGenerated": (_wxt, manifest) => {
      delete manifest.host_permissions;
    },
  },
  webExt: {
    chromiumArgs: ["--disable-features=DisableLoadExtensionCommandLineSwitch"],
  },
});
