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
  const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
  if (!tag) {
    console.error(
      "No release tag provided. Set GITHUB_REF_NAME or pass a tag argument.",
    );
    process.exit(1);
  }

  const config = (await Bun.file("scripts/release-config.json").json()) as
    | ReleaseConfig
    | undefined;

  try {
    assertReleaseVersion(
      tag,
      packageJson.version,
      config?.publishedVersions ?? { chrome: null, firefox: null },
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.log(
    `Release tag ${normalizeTag(tag)} matches package.json and is newer than configured published versions.`,
  );
}
