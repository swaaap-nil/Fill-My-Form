import { compareVersions } from "./release-version";

export interface CommitSubject {
  readonly hash: string;
  readonly subject: string;
}

interface ParsedSubject {
  readonly type: string;
  readonly scope: string | null;
  readonly breaking: boolean;
  readonly description: string;
}

const TYPE_HEADINGS: Record<string, string> = {
  feat: "Features",
  fix: "Bug Fixes",
  perf: "Performance",
  revert: "Reverts",
};

const SECTION_ORDER = [
  "Breaking Changes",
  "Features",
  "Bug Fixes",
  "Performance",
  "Reverts",
] as const;

const SUBJECT_PATTERN =
  /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<description>.+)$/;

export const parseGitLog = (text: string): CommitSubject[] =>
  text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      if (tab === -1) return { hash: "", subject: line };
      return {
        hash: line.slice(0, tab),
        subject: line.slice(tab + 1),
      };
    });

export const parseCommitSubject = (subject: string): ParsedSubject | null => {
  const match = SUBJECT_PATTERN.exec(subject);
  const type = match?.groups?.type;
  const description = match?.groups?.description;
  if (!type || !description) return null;
  return {
    type,
    scope: match.groups?.scope ?? null,
    breaking: match.groups?.breaking === "!",
    description,
  };
};

export const latestVersionTag = (tags: readonly string[]): string | null => {
  const versions = tags.filter((tag) => /^v\d/.test(tag));
  if (versions.length === 0) return null;
  return versions.reduce((latest, tag) =>
    compareVersions(tag, latest) > 0 ? tag : latest,
  );
};

export const buildChangelogSection = (options: {
  readonly version: string;
  readonly previousTag: string | null;
  readonly date: string;
  readonly repoUrl: string;
  readonly commits: readonly CommitSubject[];
}): string => {
  const tag = `v${options.version}`;
  const heading = options.previousTag
    ? `## [${options.version}](${options.repoUrl}/compare/${options.previousTag}...${tag}) (${options.date})`
    : `## [${options.version}](${options.repoUrl}/releases/tag/${tag}) (${options.date})`;

  const grouped = new Map<string, string[]>();
  const breaking: string[] = [];

  for (const commit of options.commits) {
    const parsed = parseCommitSubject(commit.subject);
    if (!parsed) continue;
    const headingName = TYPE_HEADINGS[parsed.type];
    if (!headingName) continue;

    const shortHash = commit.hash.slice(0, 7) || "unknown";
    const hashLink = commit.hash
      ? ` ([${shortHash}](${options.repoUrl}/commit/${commit.hash}))`
      : "";
    const scopePrefix = parsed.scope ? `**${parsed.scope}:** ` : "";
    const line = `* ${scopePrefix}${parsed.description}${hashLink}`;

    const list = grouped.get(headingName) ?? [];
    list.push(line);
    grouped.set(headingName, list);
    if (parsed.breaking) breaking.push(line);
  }

  if (breaking.length > 0) grouped.set("Breaking Changes", breaking);

  const parts = [heading, ""];
  let wroteItems = false;
  for (const name of SECTION_ORDER) {
    const lines = grouped.get(name);
    if (!lines?.length) continue;
    wroteItems = true;
    parts.push(`### ${name}`, "", ...lines, "");
  }

  if (!wroteItems) {
    parts.push("* See the Git history for this tag.", "");
  }

  return `${parts.join("\n")}\n`;
};

export const prependChangelog = (existing: string, section: string): string => {
  const marker = "# Changelog\n";
  const trimmed = `${existing.replace(/\s+$/, "")}\n`;
  const index = trimmed.indexOf(marker);
  if (index === -1) {
    return `${marker}\n${section}${trimmed}`;
  }

  const after = trimmed.slice(index + marker.length).replace(/^\n*/, "");
  return `${marker}\n${section}${after}`;
};

const gitText = async (args: string[]): Promise<string> => {
  const process = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return stdout;
};

if (import.meta.main) {
  const versionFlag = process.argv.indexOf("--version");
  const version = versionFlag >= 0 ? process.argv[versionFlag + 1] : undefined;
  if (!version) {
    console.error("Usage: bun run scripts/release-notes.ts --version X.Y.Z");
    process.exit(1);
  }

  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    console.error("GITHUB_REPOSITORY is required to write changelog links.");
    process.exit(1);
  }

  try {
    const tags = (await gitText(["tag", "--list", "v*"]))
      .split("\n")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const previousTag = latestVersionTag(tags);
    const logRange = previousTag ? `${previousTag}..HEAD` : "HEAD";
    const commits = parseGitLog(
      await gitText([
        "log",
        logRange,
        "--no-merges",
        "--pretty=format:%H%x09%s",
      ]),
    );
    const section = buildChangelogSection({
      version,
      previousTag,
      date: new Date().toISOString().slice(0, 10),
      repoUrl: `https://github.com/${repository}`,
      commits,
    });

    const changelog = prependChangelog(
      await Bun.file("CHANGELOG.md").text(),
      section,
    );
    await Bun.write("CHANGELOG.md", changelog);
    await Bun.write("RELEASE_NOTES.md", section.trimStart());
    console.log(`Wrote changelog for v${version}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
