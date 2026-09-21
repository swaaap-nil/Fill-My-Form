import packageJson from "../package.json" with { type: "json" };

interface ReleaseConfig {
  readonly publishedVersions: {
    readonly chrome: string | null;
    readonly firefox: string | null;
  };
}

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
  readonly raw: string;
}

const VERSION_PATTERN =
  /^v?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export const parseVersion = (input: string): ParsedVersion => {
  const match = VERSION_PATTERN.exec(input);
  const groups = match?.groups;
  if (!groups) {
    throw new Error(
      `Invalid semver version "${input}". Expected v?MAJOR.MINOR.PATCH[-PRERELEASE].`,
    );
  }

  return {
    major: Number(groups.major),
    minor: Number(groups.minor),
    patch: Number(groups.patch),
    prerelease: groups.prerelease?.split(".") ?? [],
    raw: input,
  };
};

const compareIdentifiers = (left: string, right: string): number => {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;

  if (leftNumber !== null && rightNumber !== null) {
    return Math.sign(leftNumber - rightNumber);
  }
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return Math.sign(left.localeCompare(right));
};

export const compareVersions = (left: string, right: string): number => {
  const a = parseVersion(left);
  const b = parseVersion(right);

  for (const key of ["major", "minor", "patch"] as const) {
    const diff = a[key] - b[key];
    if (diff !== 0) return Math.sign(diff);
  }

  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index++) {
    const leftIdentifier = a.prerelease[index];
    const rightIdentifier = b.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;

    const diff = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (diff !== 0) return diff;
  }

  return 0;
};

export const normalizeTag = (tag: string): string =>
  tag.startsWith("refs/tags/") ? tag.slice("refs/tags/".length) : tag;

export type VersionBump = "major" | "minor" | "patch";
export type ReleaseBump = VersionBump | "none";

export const isVersionBump = (value: string): value is VersionBump =>
  value === "major" || value === "minor" || value === "patch";

export const isReleaseBump = (value: string): value is ReleaseBump =>
  value === "none" || isVersionBump(value);

export const bumpVersion = (current: string, bump: VersionBump): string => {
  const parsed = parseVersion(current);
  if (bump === "major") return `${parsed.major + 1}.0.0`;
  if (bump === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
};

export const resolveReleaseVersion = (
  current: string,
  bump: ReleaseBump,
): {
  readonly version: string;
  readonly tag: string;
  readonly changed: boolean;
} => {
  if (bump === "none") {
    parseVersion(current);
    return { version: current, tag: `v${current}`, changed: false };
  }

  const version = bumpVersion(current, bump);
  return { version, tag: `v${version}`, changed: true };
};

export const writePackageVersion = async (
  path: string,
  version: string,
): Promise<void> => {
  const text = await Bun.file(path).text();
  if (!/"version"\s*:\s*"[^"]+"/.test(text)) {
    throw new Error(`No version field in ${path}`);
  }
  await Bun.write(
    path,
    text.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${version}$3`),
  );
};

const writeGithubOutput = async (
  values: Record<string, string>,
): Promise<void> => {
  const githubOutput = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  const body = `${lines.join("\n")}\n`;
  if (githubOutput) {
    const existing = (await Bun.file(githubOutput).exists())
      ? await Bun.file(githubOutput).text()
      : "";
    await Bun.write(githubOutput, `${existing}${body}`);
    return;
  }
  console.log(body.trimEnd());
};

const loadPublishedVersions = async (): Promise<
  ReleaseConfig["publishedVersions"]
> => {
  const config = (await Bun.file("scripts/release-config.json").json()) as
    | ReleaseConfig
    | undefined;
  return config?.publishedVersions ?? { chrome: null, firefox: null };
};

export const assertReleaseVersion = (
  tag: string,
  packageVersion: string,
  publishedVersions: ReleaseConfig["publishedVersions"],
): void => {
  const normalizedTag = normalizeTag(tag);
  const expectedTag = `v${packageVersion}`;

  parseVersion(normalizedTag);
  parseVersion(packageVersion);

  if (normalizedTag !== expectedTag) {
    throw new Error(
      `Tag ${normalizedTag} does not match package.json version ${packageVersion}; expected ${expectedTag}.`,
    );
  }

  for (const [target, publishedVersion] of Object.entries(publishedVersions)) {
    if (publishedVersion === null) continue;
    if (compareVersions(packageVersion, publishedVersion) <= 0) {
      throw new Error(
        `${target} release version ${packageVersion} must be greater than the currently published version ${publishedVersion}.`,
      );
    }
  }
};

if (import.meta.main) {
  const [command, bumpArg] = process.argv.slice(2);

  try {
    const publishedVersions = await loadPublishedVersions();

    if (command === "bump") {
      if (!bumpArg || !isReleaseBump(bumpArg)) {
        throw new Error(
          `Unknown bump "${bumpArg ?? ""}". Expected major, minor, patch, or none.`,
        );
      }

      const resolved = resolveReleaseVersion(packageJson.version, bumpArg);
      if (resolved.changed) {
        assertReleaseVersion(resolved.tag, resolved.version, publishedVersions);
        await writePackageVersion("package.json", resolved.version);
      } else {
        parseVersion(resolved.version);
      }

      const ref = resolved.changed
        ? resolved.tag
        : (process.env.GITHUB_SHA ?? "HEAD");
      await writeGithubOutput({
        version: resolved.version,
        tag: resolved.tag,
        ref,
      });
      console.log(
        resolved.changed
          ? `Bumped ${packageJson.version} -> ${resolved.version} (${bumpArg}).`
          : `Keeping ${resolved.version} with no version change.`,
      );
      process.exit(0);
    }

    const tag = command ?? process.env.GITHUB_REF_NAME;
    if (!tag) {
      throw new Error(
        "No release tag provided. Pass a tag argument or set GITHUB_REF_NAME.",
      );
    }

    assertReleaseVersion(tag, packageJson.version, publishedVersions);
    console.log(
      `Release tag ${normalizeTag(tag)} matches package.json and is newer than configured published versions.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
