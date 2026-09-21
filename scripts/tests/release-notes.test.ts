import { describe, expect, it } from "bun:test";
import {
  buildChangelogSection,
  latestVersionTag,
  parseCommitSubject,
  parseGitLog,
  prependChangelog,
} from "../release-notes";

describe("release notes", () => {
  it("parses hash-and-subject git log lines", () => {
    expect(
      parseGitLog("abc1234\tfeat: add thing\ndef5678\tfix(core): a bug"),
    ).toEqual([
      { hash: "abc1234", subject: "feat: add thing" },
      { hash: "def5678", subject: "fix(core): a bug" },
    ]);
  });

  it("parses conventional commit subjects", () => {
    expect(parseCommitSubject("feat(files): crop in a window")).toEqual({
      type: "feat",
      scope: "files",
      breaking: false,
      description: "crop in a window",
    });
    expect(parseCommitSubject("feat!: drop the old panel")).toMatchObject({
      breaking: true,
      description: "drop the old panel",
    });
    expect(parseCommitSubject("not conventional")).toBeNull();
  });

  it("picks the highest semver tag", () => {
    expect(latestVersionTag(["v1.4.1", "v1.6.0", "v1.5.9"])).toBe("v1.6.0");
    expect(latestVersionTag(["nightly"])).toBeNull();
  });

  it("groups user-facing commits into a changelog section", () => {
    const section = buildChangelogSection({
      version: "1.6.1",
      previousTag: "v1.6.0",
      date: "2026-09-21",
      repoUrl: "https://github.com/swaaap-nil/Fill-My-Form",
      commits: [
        {
          hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          subject: "feat(fill): remember the last tab",
        },
        {
          hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          subject: "fix: skip hidden file inputs",
        },
        {
          hash: "cccccccccccccccccccccccccccccccccccccccc",
          subject: "chore: ignore this",
        },
      ],
    });

    expect(section).toContain(
      "## [1.6.1](https://github.com/swaaap-nil/Fill-My-Form/compare/v1.6.0...v1.6.1) (2026-09-21)",
    );
    expect(section).toContain("### Features");
    expect(section).toContain("**fill:** remember the last tab");
    expect(section).toContain("### Bug Fixes");
    expect(section).toContain("skip hidden file inputs");
    expect(section).not.toContain("ignore this");
  });

  it("prepends a section after the changelog heading", () => {
    const next = prependChangelog(
      "# Changelog\n\n## [1.6.0](url) (2026-09-21)\n",
      "## [1.6.1](url) (2026-09-22)\n\n",
    );
    expect(next.startsWith("# Changelog\n\n## [1.6.1]")).toBe(true);
    expect(next).toContain("## [1.6.0]");
  });
});
