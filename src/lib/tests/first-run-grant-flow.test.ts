import { describe, expect, it } from "bun:test";
import { runFirstRunAllSitesGrant } from "~/lib/first-run-grant-flow";

describe("runFirstRunAllSitesGrant", () => {
  it("completes when the grant succeeds", async () => {
    let marked: { globalDeclined: boolean } | undefined;
    const outcome = await runFirstRunAllSitesGrant({
      requestAllSiteAccess: async () => true,
      markFirstRunSiteAccess: async (update) => {
        marked = update;
      },
      activeTabId: 1,
    });

    expect(outcome).toEqual({ kind: "completed", granted: true });
    expect(marked).toEqual({ globalDeclined: false });
  });

  it("completes with granted false when the user declines the browser prompt", async () => {
    const outcome = await runFirstRunAllSitesGrant({
      requestAllSiteAccess: async () => false,
      markFirstRunSiteAccess: async () => {},
    });

    expect(outcome).toEqual({ kind: "completed", granted: false });
  });

  it("reports failed when the permission API throws", async () => {
    const outcome = await runFirstRunAllSitesGrant({
      requestAllSiteAccess: async () => {
        throw new Error("This function must be called during a user gesture");
      },
      markFirstRunSiteAccess: async () => {},
    });

    expect(outcome).toEqual({ kind: "failed", reason: "request_threw" });
  });
});
