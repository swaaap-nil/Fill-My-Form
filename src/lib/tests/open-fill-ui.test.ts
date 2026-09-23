import { beforeEach, describe, expect, it, mock } from "bun:test";

const setPendingFillTabId = mock(async (_tabId: number) => {});
mock.module("~/lib/pending-fill-tab", () => ({ setPendingFillTabId }));

const { focusTabAndOpenFillUi } = await import("~/lib/open-fill-ui");

const makeBrowser = (
  extra: Partial<Parameters<typeof focusTabAndOpenFillUi>[0]> = {},
) => {
  const calls: string[] = [];
  const browserApi = {
    tabs: {
      update: mock(async (tabId: number, props: { active: boolean }) => {
        calls.push(`tabs.update:${tabId}:${props.active}`);
        return {} as never;
      }),
    },
    ...extra,
  };
  return { browserApi, calls };
};

describe("focusTabAndOpenFillUi", () => {
  beforeEach(() => setPendingFillTabId.mockClear());

  it("activates the tab, records it as the fill target, then opens the side panel", async () => {
    const open = mock(
      async (_opts: { windowId: number; tabId?: number }) => {},
    );
    const { browserApi, calls } = makeBrowser({ sidePanel: { open } });

    const result = await focusTabAndOpenFillUi(browserApi, 7, 3);

    expect(result).toEqual({ opened: true });
    expect(calls).toEqual(["tabs.update:7:true"]);
    expect(setPendingFillTabId).toHaveBeenCalledWith(7);
    expect(open).toHaveBeenCalledWith({ windowId: 3, tabId: 7 });
  });

  it("opens the sidebar when there is no side panel", async () => {
    const open = mock(async () => {});
    const { browserApi } = makeBrowser({ sidebarAction: { open } });

    expect(await focusTabAndOpenFillUi(browserApi, 7, 3)).toEqual({
      opened: true,
    });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("falls back to the badge when the sidebar refuses to open", async () => {
    const setBadgeText = mock(
      async (_d: { text: string; tabId?: number }) => {},
    );
    const { browserApi } = makeBrowser({
      sidebarAction: {
        open: async () => {
          throw new Error("needs user gesture");
        },
      },
      action: { setBadgeText },
    });

    expect(await focusTabAndOpenFillUi(browserApi, 7, 3)).toEqual({
      opened: false,
    });
    expect(setBadgeText).toHaveBeenCalledWith({ text: "1" });
    expect(setPendingFillTabId).toHaveBeenCalledWith(7);
  });

  it("reports not opened when no fill surface exists", async () => {
    const { browserApi } = makeBrowser();

    expect(await focusTabAndOpenFillUi(browserApi, 7, 3)).toEqual({
      opened: false,
    });
  });

  it("starts opening the side panel before any other async work settles (user-gesture window)", async () => {
    const order: string[] = [];
    let releaseTabs: () => void = () => {};
    const open = mock(async (_opts: { windowId: number; tabId?: number }) => {
      order.push("sidePanel.open");
    });
    const browserApi = {
      tabs: {
        update: mock(
          () =>
            new Promise<never>((resolve) => {
              order.push("tabs.update");
              releaseTabs = () => resolve({} as never);
            }),
        ),
      },
      sidePanel: { open },
    };

    const pending = focusTabAndOpenFillUi(browserApi, 7, 3);

    // Synchronously after the call, with tabs.update still unresolved.
    expect(order[0]).toBe("sidePanel.open");
    releaseTabs();
    await pending;
  });

  it("opens the side panel by tab id alone when no window id is given", async () => {
    const open = mock(
      async (_opts: { windowId?: number; tabId?: number }) => {},
    );
    const { browserApi } = makeBrowser({ sidePanel: { open } });

    await focusTabAndOpenFillUi(browserApi, 7);

    expect(open).toHaveBeenCalledWith({ tabId: 7 });
  });

  it("starts opening the sidebar before any other async work settles", async () => {
    const order: string[] = [];
    let releaseTabs: () => void = () => {};
    const browserApi = {
      tabs: {
        update: mock(
          () =>
            new Promise<never>((resolve) => {
              order.push("tabs.update");
              releaseTabs = () => resolve({} as never);
            }),
        ),
      },
      sidebarAction: {
        open: mock(async () => {
          order.push("sidebarAction.open");
        }),
      },
    };

    const pending = focusTabAndOpenFillUi(browserApi, 7, 3);

    expect(order[0]).toBe("sidebarAction.open");
    releaseTabs();
    expect(await pending).toEqual({ opened: true });
  });
});
