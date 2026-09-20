import { describe, expect, it } from "bun:test";
import { nullLogger } from "~/core/logging";
import {
  type SidePanelBrowser,
  wireToolbarIconBehavior,
} from "~/lib/toolbar-icon";

/**
 * Hand-written fakes, not a mocking library — same rationale as
 * `~/lib/tests/site-access.test.ts`: state lives in plain objects so a test
 * can inspect it directly rather than asserting on call-spy internals.
 */
const createChromeBrowser = () => {
  const state: { panelBehavior?: { openPanelOnActionClick: boolean } } = {};

  const browser: SidePanelBrowser = {
    sidePanel: {
      async setPanelBehavior(opts) {
        state.panelBehavior = opts;
      },
    },
    action: {
      onClicked: { addListener() {} },
      async setBadgeText() {},
    },
  };

  return { browser, state };
};

const createFirefoxBrowser = (withSidebarAction = true) => {
  const state = { toggled: 0 };
  let listener: (() => void) | undefined;

  const browser: SidePanelBrowser = {
    sidebarAction: withSidebarAction
      ? {
          async toggle() {
            state.toggled += 1;
          },
        }
      : undefined,
    action: {
      onClicked: {
        addListener(fn) {
          listener = fn;
        },
      },
      async setBadgeText() {},
    },
  };

  return { browser, state, click: () => listener?.() };
};

describe("wireToolbarIconBehavior", () => {
  it("sets Chrome's side panel to open on action click when sidePanel is present", async () => {
    const { browser, state } = createChromeBrowser();

    wireToolbarIconBehavior(browser, nullLogger);
    // setPanelBehavior is fire-and-forget; give its promise a tick.
    await Promise.resolve();

    expect(state.panelBehavior).toEqual({ openPanelOnActionClick: true });
  });

  it("toggles Firefox's sidebar when the toolbar icon is clicked", async () => {
    const { browser, state, click } = createFirefoxBrowser();

    wireToolbarIconBehavior(browser, nullLogger);
    click();
    await Promise.resolve();

    expect(state.toggled).toBe(1);
  });

  it("does not throw when Firefox has no sidebarAction to toggle", () => {
    const { browser, click } = createFirefoxBrowser(false);

    wireToolbarIconBehavior(browser, nullLogger);

    expect(() => click()).not.toThrow();
  });
});
