import { describe, expect, it } from "bun:test";
import { isFirstRunAccessGatePending } from "~/lib/first-run-access";

describe("isFirstRunAccessGatePending", () => {
  it("shows until the user has chosen and all-site access is missing", () => {
    expect(isFirstRunAccessGatePending(false, false)).toBe(true);
  });

  it("hides after the user has seen the prompt", () => {
    expect(isFirstRunAccessGatePending(false, true)).toBe(false);
  });

  it("hides when all-site access is already granted", () => {
    expect(isFirstRunAccessGatePending(true, false)).toBe(false);
  });
});
