import { describe, expect, it } from "bun:test";
import { neverLoadedFiles, parseLcov, summarizeScope } from "../check-coverage";

const lcov = (
  entries: readonly {
    path: string;
    lf: number;
    lh: number;
    fnf: number;
    fnh: number;
  }[],
) =>
  entries
    .map(
      (e) =>
        `TN:\nSF:${e.path}\nFNF:${e.fnf}\nFNH:${e.fnh}\nDA:1,1\nLF:${e.lf}\nLH:${e.lh}\nend_of_record`,
    )
    .join("\n");

describe("parseLcov", () => {
  it("reads found/hit counts for every SF record", () => {
    const records = parseLcov(
      lcov([{ path: "src/core/a.ts", lf: 10, lh: 8, fnf: 2, fnh: 1 }]),
    );
    expect(records).toEqual([
      {
        path: "src/core/a.ts",
        linesFound: 10,
        linesHit: 8,
        funcsFound: 2,
        funcsHit: 1,
      },
    ]);
  });

  it("parses multiple records, not just the first", () => {
    const records = parseLcov(
      lcov([
        { path: "src/core/a.ts", lf: 10, lh: 10, fnf: 1, fnh: 1 },
        { path: "src/lib/b.ts", lf: 4, lh: 0, fnf: 1, fnh: 0 },
      ]),
    );
    expect(records.map((r) => r.path)).toEqual([
      "src/core/a.ts",
      "src/lib/b.ts",
    ]);
  });

  it("returns an empty list for text with no SF records", () => {
    expect(parseLcov("TN:\nend_of_record")).toEqual([]);
  });
});

describe("summarizeScope", () => {
  const floor = { line: 0.8, func: 0.8 };

  it("aggregates lines and functions across every file in scope, not per file", () => {
    const records = parseLcov(
      lcov([
        { path: "src/core/a.ts", lf: 10, lh: 10, fnf: 2, fnh: 2 },
        { path: "src/core/b.ts", lf: 10, lh: 6, fnf: 2, fnh: 1 },
      ]),
    );
    const result = summarizeScope(records, "src/core", floor);
    // 16/20 lines, 3/4 functions — a low-coverage file does not sink the
    // aggregate on its own, but does pull it down.
    expect(result.lineRatio).toBeCloseTo(0.8);
    expect(result.funcRatio).toBeCloseTo(0.75);
    expect(result.linePasses).toBe(true);
    expect(result.funcPasses).toBe(false);
  });

  it("excludes files outside the scope prefix", () => {
    const records = parseLcov(
      lcov([
        { path: "src/core/a.ts", lf: 10, lh: 10, fnf: 1, fnh: 1 },
        { path: "src/lib/b.ts", lf: 10, lh: 0, fnf: 1, fnh: 0 },
      ]),
    );
    const result = summarizeScope(records, "src/core", floor);
    expect(result.lineRatio).toBe(1);
  });

  it("does not match a scope as a substring of a different top-level dir", () => {
    const records = parseLcov(
      lcov([{ path: "src/core-extra/a.ts", lf: 10, lh: 0, fnf: 1, fnh: 0 }]),
    );
    const result = summarizeScope(records, "src/core", floor);
    // An empty scope reads as 100%, not 0% — nothing in it to fail on.
    expect(result.lineRatio).toBe(1);
  });

  it("excludes test files from the aggregate", () => {
    const records = parseLcov(
      lcov([
        { path: "src/core/a.ts", lf: 10, lh: 10, fnf: 1, fnh: 1 },
        {
          path: "src/core/tests/a.test.ts",
          lf: 10,
          lh: 0,
          fnf: 1,
          fnh: 0,
        },
      ]),
    );
    const result = summarizeScope(records, "src/core", floor);
    expect(result.lineRatio).toBe(1);
  });

  it("treats a scope with nothing measured as passing, not as a divide-by-zero failure", () => {
    const result = summarizeScope([], "src/core", floor);
    expect(result.lineRatio).toBe(1);
    expect(result.funcRatio).toBe(1);
    expect(result.linePasses).toBe(true);
    expect(result.funcPasses).toBe(true);
  });
});

describe("neverLoadedFiles", () => {
  it("lists a source file in scope that lcov has no record for", () => {
    const records = parseLcov(
      lcov([{ path: "src/core/a.ts", lf: 10, lh: 10, fnf: 1, fnh: 1 }]),
    );
    const result = neverLoadedFiles(
      ["src/core/a.ts", "src/core/b.ts"],
      records,
      "src/core",
    );
    expect(result).toEqual(["src/core/b.ts"]);
  });

  it("does not list a file outside the scope", () => {
    const result = neverLoadedFiles(["src/lib/a.ts"], [], "src/core");
    expect(result).toEqual([]);
  });

  it("does not list a test file", () => {
    const result = neverLoadedFiles(
      ["src/core/tests/a.test.ts"],
      [],
      "src/core",
    );
    expect(result).toEqual([]);
  });
});
