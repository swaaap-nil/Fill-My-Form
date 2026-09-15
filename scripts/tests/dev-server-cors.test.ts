import { describe, expect, it } from "bun:test";
import { EXTENSION_ORIGIN_PATTERN } from "../dev-server-cors";

describe("EXTENSION_ORIGIN_PATTERN", () => {
  it("allows Chrome extension origins", () => {
    expect(EXTENSION_ORIGIN_PATTERN.test("chrome-extension://abc123")).toBe(
      true,
    );
  });

  it("allows Firefox extension origins", () => {
    expect(EXTENSION_ORIGIN_PATTERN.test("moz-extension://abc123")).toBe(true);
  });

  it("rejects an unrelated origin", () => {
    expect(EXTENSION_ORIGIN_PATTERN.test("https://evil.com")).toBe(false);
  });

  it("rejects a spoofed host masquerading as an extension origin", () => {
    expect(
      EXTENSION_ORIGIN_PATTERN.test("https://chrome-extension.evil.com"),
    ).toBe(false);
  });
});
