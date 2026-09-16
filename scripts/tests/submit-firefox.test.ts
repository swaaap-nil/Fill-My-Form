import { describe, expect, it } from "bun:test";
import {
  amoJwt,
  configFromEnv,
  defaultArtifactPaths,
  hasCategories,
  retryAfterSeconds,
} from "../submit-firefox";

describe("firefox submit helpers", () => {
  it("names zips from the package version", () => {
    expect(defaultArtifactPaths("1.0.1")).toEqual({
      zip: "build/fill-my-form-1.0.1-firefox.zip",
      sourcesZip: "build/fill-my-form-1.0.1-sources.zip",
    });
  });

  it("signs a short-lived AMO JWT", () => {
    const token = amoJwt("issuer", "secret", 1_700_000_000, 240);
    const parts = token.split(".");
    const payload = parts[1];
    expect(parts).toHaveLength(3);
    expect(payload).toBeDefined();
    if (!payload) {
      throw new Error("JWT payload missing");
    }

    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    );
    expect(claims).toMatchObject({
      iss: "issuer",
      iat: 1_700_000_000,
      exp: 1_700_000_240,
    });
    expect(claims).toEqual(
      expect.objectContaining({
        jti: expect.any(String),
      }),
    );
  });

  it("reads credentials and defaults the all-rights-reserved slug", () => {
    const config = configFromEnv(["--dry-run", "addon.zip", "sources.zip"], {
      FIREFOX_EXTENSION_ID: "ff@example.com",
      FIREFOX_JWT_ISSUER: "issuer",
      FIREFOX_JWT_SECRET: "secret",
    });

    expect(config.dryRun).toBe(true);
    expect(config.extensionId).toBe("ff@example.com");
    expect(config.channel).toBe("listed");
    expect(config.license).toBe("all-rights-reserved");
    expect(config.categories).toEqual(["privacy-security"]);
    expect(config.zip.endsWith("addon.zip")).toBe(true);
    expect(config.sourcesZip.endsWith("sources.zip")).toBe(true);
  });

  it("fails when JWT credentials are missing", () => {
    expect(() =>
      configFromEnv([], { FIREFOX_EXTENSION_ID: "ff@example.com" }),
    ).toThrow(/FIREFOX_JWT_ISSUER/);
  });

  it("treats empty AMO category lists as missing", () => {
    expect(hasCategories([])).toBe(false);
    expect(hasCategories({ firefox: [] })).toBe(false);
    expect(hasCategories(["privacy-security"])).toBe(true);
    expect(hasCategories({ firefox: ["privacy-security"] })).toBe(true);
  });

  it("parses AMO throttle wait from the error body", () => {
    const response = new Response(null, { status: 429 });
    expect(
      retryAfterSeconds(response, {
        detail: "Request was throttled. Expected available in 880 seconds.",
      }),
    ).toBe(880);
  });
});
