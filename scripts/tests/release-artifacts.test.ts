import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertArtifactsExist,
  expectedReleaseArtifacts,
} from "../release-artifacts";

describe("release artifacts", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("uses WXT's deterministic zip names for the package version", () => {
    expect(expectedReleaseArtifacts("build", "ai-form-agent", "0.1.1")).toEqual(
      {
        chromeZip: "build/ai-form-agent-0.1.1-chrome.zip",
        firefoxZip: "build/ai-form-agent-0.1.1-firefox.zip",
        sourcesZip: "build/ai-form-agent-0.1.1-sources.zip",
      },
    );
  });

  it("passes when all release artifacts exist", async () => {
    dir = await mkdtemp(join(tmpdir(), "release-artifacts-"));
    await mkdir(join(dir, "build"));
    const artifacts = expectedReleaseArtifacts(
      join(dir, "build"),
      "ai-form-agent",
      "0.1.1",
    );

    for (const path of Object.values(artifacts)) {
      await writeFile(path, "");
    }

    await expect(assertArtifactsExist(artifacts)).resolves.toBeUndefined();
  });

  it("fails when an expected release artifact is missing", async () => {
    dir = await mkdtemp(join(tmpdir(), "release-artifacts-missing-"));
    await mkdir(join(dir, "build"));
    const artifacts = expectedReleaseArtifacts(
      join(dir, "build"),
      "ai-form-agent",
      "0.1.1",
    );

    await writeFile(artifacts.chromeZip, "");
    await writeFile(artifacts.firefoxZip, "");

    await expect(assertArtifactsExist(artifacts)).rejects.toThrow(/sourcesZip/);
  });
});
