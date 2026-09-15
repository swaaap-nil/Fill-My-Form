import type { Logger } from "~/core/logging";

/** The slice of the WebExtension `browser` API {@link wireToolbarIconBehavior} needs. */
export interface SidePanelBrowser {
  readonly sidePanel?: {
    setPanelBehavior(opts: { openPanelOnActionClick: boolean }): Promise<void>;
  };
  /** Firefox-only; not in `@wxt-dev/browser`'s Chrome-derived types. */
  readonly sidebarAction?: { toggle(): Promise<void> };
  readonly action: { onClicked: { addListener(fn: () => void): void } };
}

/**
 * Clicking the toolbar icon opens the side panel. Requires no
 * `action.default_popup` in the manifest, and Chrome only. Firefox has no
 * sidePanel API, so this is feature-detected rather than assumed.
 *
 * Firefox: WXT emits a `sidebar_action` for the built-in sidebar, but that
 * API has no Chrome-style "open on action click" behavior — the `action`
 * (toolbar) button and the sidebar are separate UI, and with no
 * `default_popup` the toolbar button otherwise does nothing when clicked.
 * Wire the two together explicitly via `sidebarAction.toggle`.
 *
 * Dependency-injected — takes a `SidePanelBrowser` explicitly, not
 * `wxt/browser` at module scope — so it can be tested with a hand-written
 * fake rather than a real extension context, and lives outside the
 * `defineBackground` entrypoint so it can be imported from a plain unit
 * test. See `~/lib/site-access` for the same pattern.
 */
export const wireToolbarIconBehavior = (
  browser: SidePanelBrowser,
  logger: Logger,
): void => {
  if (browser.sidePanel) {
    browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: unknown) =>
        logger.warn("could not set side panel behavior", {
          errorCode: String(error),
        }),
      );
  } else {
    browser.action.onClicked.addListener(() => {
      browser.sidebarAction?.toggle().catch((error: unknown) =>
        logger.warn("could not toggle sidebar", {
          errorCode: String(error),
        }),
      );
    });
  }
};
