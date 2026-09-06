import { access } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

export interface ReleaseArtifacts {
  readonly chromeZip: string;
  readonly firefoxZip: string;
  readonly sourcesZip: string;
}

export const expectedReleaseArtifacts = (
  buildDir: string,
  packageName: string,
  packageVersion: string,
): ReleaseArtifacts => ({
  chromeZip: join(buildDir, `${packageName}-${packageVersion}-chrome.zip`),
  firefoxZip: join(buildDir, `${packageName}-${packageVersion}-firefox.zip`),
  sourcesZip: join(buildDir, `${packageName}-${packageVersion}-sources.zip`),
});

export const assertArtifactsExist = async (
  artifacts: ReleaseArtifacts,
): Promise<void> => {
  for (const [name, path] of Object.entries(artifacts)) {
    try {
      await access(path);
    } catch {
      throw new Error(`Missing ${name}: ${path}`);
    }
  }
};

if (import.meta.main) {
  const artifacts = expectedReleaseArtifacts(
    "build",
    packageJson.name,
    packageJson.version,
  );

  try {
    await assertArtifactsExist(artifacts);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  const lines = [
    `chrome_zip=${artifacts.chromeZip}`,
    `firefox_zip=${artifacts.firefoxZip}`,
    `sources_zip=${artifacts.sourcesZip}`,
  ];

  if (githubOutput) {
    await Bun.write(githubOutput, `${lines.join("\n")}\n`);
  } else {
    console.log(lines.join("\n"));
  }
}
