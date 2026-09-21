import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertReleaseVersion,
  bumpVersion,
  compareVersions,
  normalizeTag,
  parseVersion,
  resolveReleaseVersion,
  writePackageVersion,
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

  it("bumps major, minor and patch, zeroing the lesser numbers", () => {
    expect(bumpVersion("1.6.0", "patch")).toBe("1.6.1");
    expect(bumpVersion("1.6.4", "minor")).toBe("1.7.0");
    expect(bumpVersion("1.6.4", "major")).toBe("2.0.0");
  });

  it("keeps the current version when the bump is none", () => {
    expect(resolveReleaseVersion("1.7.0", "none")).toEqual({
      version: "1.7.0",
      tag: "v1.7.0",
      changed: false,
    });
    expect(resolveReleaseVersion("1.7.0", "patch")).toEqual({
      version: "1.7.1",
      tag: "v1.7.1",
      changed: true,
    });
  });

  it("rewrites only the package.json version field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "package-version-"));
    const path = join(dir, "package.json");
    await writeFile(
      path,
      `{
  "name": "fill-my-form",
  "version": "1.6.0",
  "private": true
}
`,
    );

    try {
      await writePackageVersion(path, "1.6.1");
      expect(await readFile(path, "utf8")).toContain('"version": "1.6.1"');
      expect(await readFile(path, "utf8")).toContain('"name": "fill-my-form"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
