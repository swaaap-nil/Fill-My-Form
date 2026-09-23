import { describe, expect, it } from "bun:test";
import { classifyScanReadFailure } from "~/lib/scan-read-outcome";

describe("classifyScanReadFailure", () => {
  it("keeps access granted when the permission is held but injection was refused", () => {
    expect(
      classifyScanReadFailure({ permissionHeld: true, injectionRefused: true }),
    ).toEqual({ activeTabGranted: true, hint: "unreadable_page" });
  });

  it("keeps access granted when the permission is held and the read failed", () => {
    expect(
      classifyScanReadFailure({
        permissionHeld: true,
        injectionRefused: false,
      }),
    ).toEqual({ activeTabGranted: true, hint: "unreadable_page" });
  });

  it("reports access as missing when the permission is truly absent", () => {
    expect(
      classifyScanReadFailure({
        permissionHeld: false,
        injectionRefused: false,
      }),
    ).toEqual({ activeTabGranted: false, hint: "needs_access" });
  });
});
