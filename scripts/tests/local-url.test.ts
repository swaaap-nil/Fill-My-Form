import { describe, expect, it } from "bun:test";
import { isLocalE2eUrl } from "../../e2e/local-url";

describe("local e2e request allowlist", () => {
  it("allows the fixture server and extension pages", () => {
    expect(isLocalE2eUrl("http://localhost:4173/aai-more.html")).toBe(true);
    expect(isLocalE2eUrl("http://127.0.0.1:4173/simple.html")).toBe(true);
    expect(isLocalE2eUrl("chrome-extension://abcdef/sidepanel.html")).toBe(
      true,
    );
    expect(isLocalE2eUrl("data:text/plain,hello")).toBe(true);
  });

  it("rejects live third-party hosts copied pages still reference", () => {
    expect(
      isLocalE2eUrl("https://www.googletagmanager.com/gtag/js?id=G-TEST"),
    ).toBe(false);
    expect(isLocalE2eUrl("https://ibpsreg.ibps.in/aaioct25/logo.jpg")).toBe(
      false,
    );
  });
});
