import ReactDOM from "react-dom/client";
import { createShadowRootUi, defineContentScript } from "#imports";
import { Logo } from "@/components/common/logo";

import "~/assets/styles/globals.css";

/**
 * `registration: "runtime"` keeps this script OUT of the manifest.
 *
 * A declared content script matching `<all_urls>` grants code injection into
 * every page at install time — which would undo the narrow permissions in
 * `wxt.config.ts` and show the user "read and change all your data on all
 * websites" regardless. Instead the background worker registers this script
 * for a specific origin once the user grants access to that site.
 *
 * See docs/privacy.md. `matches` below is the *upper bound* of what may ever
 * be registered, not what is granted.
 */
const ContentScriptUI = () => (
  <div className="pointer-events-none fixed right-4 bottom-4 flex items-center gap-2 rounded-lg bg-background/90 px-3 py-2 text-foreground text-sm shadow-lg ring-1 ring-border">
    <Logo className="w-4 text-primary" />
    <span>Form Agent is watching this page</span>
  </div>
);

export default defineContentScript({
  matches: ["https://*/*", "http://*/*"],
  registration: "runtime",
  cssInjectionMode: "ui",

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "form-agent-ui",
      position: "overlay",
      anchor: "body",
      onMount: (container) => {
        const app = document.createElement("div");
        container.append(app);

        const root = ReactDOM.createRoot(app);
        root.render(<ContentScriptUI />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
