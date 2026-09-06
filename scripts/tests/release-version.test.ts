import { describe, expect, it } from "bun:test";
import {
  assertReleaseVersion,
  compareVersions,
  normalizeTag,
  parseVersion,
} from "../release-version";

describe("release version checks", () => {
  it("normalizes full git tag refs", () => {
    expect(normalizeTag("refs/tags/v1.2.3")).toBe("v1.2.3");
  });

  it("rejects tags that are not semver", () => {
    expect(() => parseVersion("v1.2")).toThrow(/Invalid semver/);
  });

  it("compares stable versions by major, minor and patch", () => {
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3", "2.0.0")).toBe(-1);
  });

  it("treats a prerelease as older than its final release", () => {
    expect(compareVersions("1.2.3-rc.1", "1.2.3")).toBe(-1);
    expect(compareVersions("1.2.4-rc.1", "1.2.3")).toBe(1);
  });

  it("passes when the tag matches package.json and exceeds published versions", () => {
    expect(() =>
      assertReleaseVersion("v0.1.1", "0.1.1", {
        chrome: null,
        firefox: "0.1.0",
      }),
    ).not.toThrow();
  });

  it("fails when the tag does not match package.json", () => {
    expect(() =>
      assertReleaseVersion("v0.1.2", "0.1.1", {
        chrome: null,
        firefox: "0.1.0",
      }),
    ).toThrow(/does not match package\.json/);
  });

  it("fails when the release does not exceed a published store version", () => {
    expect(() =>
      assertReleaseVersion("v0.1.0", "0.1.0", {
        chrome: null,
        firefox: "0.1.0",
      }),
    ).toThrow(/must be greater/);
  });
});
