/**
 * A coverage floor for `src/core` and `src/lib`, plus a list of source
 * files under them that no test loads at all.
 *
 * `bun test --coverage`'s own per-file `coverageThreshold` (bunfig.toml)
 * turns out to be the wrong tool for this: it is a single scalar applied to
 * every loaded file's line *and* function percentage alike, so a pure
 * types-only file (zero functions) reads as 0% function coverage and fails
 * a threshold that has nothing to do with it — confirmed directly against
 * this repo's `src/core/form/types.ts` and `src/core/policy/types.ts`
 * before deciding not to use it. It also cannot see a file no test ever
 * imports: an unloaded file has no coverage entry at all, not a 0% one, so
 * a per-file floor silently says nothing about the biggest risk.
 *
 * This script instead parses `bun test`'s own lcov output, aggregates line
 * and function coverage across `src/core` and `src/lib` as a whole (not
 * per file, so a legitimate low-value file does not sink the build on its
 * own), and separately diffs the source tree against the files lcov
 * actually reports on. The floor is a regression guard, set below the
 * aggregate measured when this script was written — not a target to chase
 * file by file.
 */

/**
 * Set a few points below the aggregate measured when this script was
 * written (`src/core`: 83.6% lines / 92.4% functions; `src/lib`: 70.3% /
 * 77.0%) — a regression guard, not a target. `src/lib` is lower because it
 * is the adapter layer: some of it (`~/lib/files/image-preparation-adapter`)
 * is pixel work `docs/testing.md` deliberately keeps e2e-only, and some of
 * it (background wiring, messaging) has no seam yet. Raise these as real
 * coverage lands, not by loosening the check.
 */
const FLOORS: Record<(typeof SCOPES)[number], { line: number; func: number }> =
  {
    "src/core": { line: 0.8, func: 0.88 },
    "src/lib": { line: 0.65, func: 0.72 },
  };

const SCOPES = ["src/core", "src/lib"] as const;

interface FileCoverage {
  readonly path: string;
  readonly linesFound: number;
  readonly linesHit: number;
  readonly funcsFound: number;
  readonly funcsHit: number;
}

type MutableFileCoverage = {
  -readonly [K in keyof FileCoverage]?: FileCoverage[K];
};

/** Parses `bun test --coverage-reporter=lcov`'s output into per-file records. */
export const parseLcov = (text: string): FileCoverage[] => {
  const records: FileCoverage[] = [];
  let current: MutableFileCoverage | undefined;

  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      current = { path: line.slice(3).trim() };
    } else if (current && line.startsWith("FNF:")) {
      current.funcsFound = Number(line.slice(4));
    } else if (current && line.startsWith("FNH:")) {
      current.funcsHit = Number(line.slice(4));
    } else if (current && line.startsWith("LF:")) {
      current.linesFound = Number(line.slice(3));
    } else if (current && line.startsWith("LH:")) {
      current.linesHit = Number(line.slice(3));
    } else if (line.startsWith("end_of_record") && current) {
      records.push({
        path: current.path ?? "",
        linesFound: current.linesFound ?? 0,
        linesHit: current.linesHit ?? 0,
        funcsFound: current.funcsFound ?? 0,
        funcsHit: current.funcsHit ?? 0,
      });
      current = undefined;
    }
  }
  return records;
};

const isTestFile = (path: string): boolean =>
  /(^|\/)tests\//.test(path) || /\.test\.tsx?$/.test(path);

const inScope = (path: string, scope: string): boolean =>
  path === scope || path.startsWith(`${scope}/`);

export interface ScopeResult {
  readonly scope: string;
  readonly lineRatio: number;
  readonly funcRatio: number;
  readonly linePasses: boolean;
  readonly funcPasses: boolean;
}

export const summarizeScope = (
  records: readonly FileCoverage[],
  scope: string,
  floor: { readonly line: number; readonly func: number },
): ScopeResult => {
  const inFiles = records.filter(
    (r) => inScope(r.path, scope) && !isTestFile(r.path),
  );
  const linesFound = inFiles.reduce((sum, r) => sum + r.linesFound, 0);
  const linesHit = inFiles.reduce((sum, r) => sum + r.linesHit, 0);
  const funcsFound = inFiles.reduce((sum, r) => sum + r.funcsFound, 0);
  const funcsHit = inFiles.reduce((sum, r) => sum + r.funcsHit, 0);
  const lineRatio = linesFound === 0 ? 1 : linesHit / linesFound;
  const funcRatio = funcsFound === 0 ? 1 : funcsHit / funcsFound;
  return {
    scope,
    lineRatio,
    funcRatio,
    linePasses: lineRatio >= floor.line,
    funcPasses: funcRatio >= floor.func,
  };
};

/** Source files under `scope` that lcov has no record for at all. */
export const neverLoadedFiles = (
  allSourceFiles: readonly string[],
  records: readonly FileCoverage[],
  scope: string,
): string[] => {
  const covered = new Set(records.map((r) => r.path));
  return allSourceFiles
    .filter((path) => inScope(path, scope) && !isTestFile(path))
    .filter((path) => !covered.has(path))
    .sort();
};

if (import.meta.main) {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const coverageDir = ".coverage-check-tmp";
  const proc = Bun.spawn(
    [
      "bun",
      "test",
      "./src",
      "./scripts",
      "--coverage",
      "--coverage-reporter=lcov",
      `--coverage-dir=${coverageDir}`,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("Unit tests failed; skipping the coverage floor check.");
    process.exit(exitCode);
  }

  const lcovText = await Bun.file(join(coverageDir, "lcov.info")).text();
  const records = parseLcov(lcovText);

  const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return /\.tsx?$/.test(entry.name) ? [path] : [];
      }),
    );
    return files.flat();
  };
  const allSourceFiles = (
    await Promise.all(SCOPES.map((scope) => walk(scope)))
  ).flat();

  let ok = true;
  for (const scope of SCOPES) {
    const floor = FLOORS[scope];
    const result = summarizeScope(records, scope, floor);
    const line = `${(result.lineRatio * 100).toFixed(1)}%`;
    const func = `${(result.funcRatio * 100).toFixed(1)}%`;
    console.log(
      `${scope}: lines ${line} (floor ${floor.line * 100}%), functions ${func} (floor ${floor.func * 100}%)`,
    );
    if (!result.linePasses || !result.funcPasses) {
      console.error(`  below floor.`);
      ok = false;
    }

    const unloaded = neverLoadedFiles(allSourceFiles, records, scope);
    if (unloaded.length > 0) {
      console.log(
        `  never loaded by any test (${unloaded.length}):\n${unloaded.map((f) => `    ${f}`).join("\n")}`,
      );
    }
  }

  await Bun.$`rm -rf ${coverageDir}`.quiet();

  if (!ok) {
    console.error("Coverage floor not met.");
    process.exit(1);
  }
  console.log("Coverage floor met.");
}
