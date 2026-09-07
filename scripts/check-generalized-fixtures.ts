import { readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";

const ALLOW_COMMENT = "fixture-generalization-allow:";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);
const TEST_PATH_SEGMENTS = new Set(["tests", "__tests__", "__mocks__"]);

const SITE_NAME_TERMS = ["aai", "ashby", "ibps", "supabase"];
const SUSPICIOUS_CONTEXT =
  /\b(if|else if|switch|case)\b|\b(document\.title|location\.(?:host|hostname|href|origin)|origin\.(?:includes|startsWith|endsWith|match)|url\.hostname)\b/;
const SITE_CONTEXT =
  /\b(document\.title|location\.(?:host|hostname|href|origin)|origin\.(?:includes|startsWith|endsWith|match)|url\.hostname)\b/;
const IGNORED_FIXTURE_DOMAINS = new Set(["schema.org", "www.w3.org"]);

export interface FixtureSignals {
  readonly fixtureFilenames: readonly string[];
  readonly fixtureStems: readonly string[];
  readonly domains: readonly string[];
  readonly vendorClasses: readonly string[];
}

export interface GeneralizedFixtureFinding {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly rule: string;
  readonly message: string;
  readonly excerpt: string;
}

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasAllowComment = (line: string): boolean => {
  const index = line.indexOf(ALLOW_COMMENT);
  return (
    index >= 0 && line.slice(index + ALLOW_COMMENT.length).trim().length > 0
  );
};

interface CommentState {
  inBlock: boolean;
}

const stripComments = (
  line: string,
  state: CommentState = { inBlock: false },
): string => {
  let output = "";
  let i = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;

  while (i < line.length) {
    const ch = line[i] ?? "";
    const next = line[i + 1] ?? "";

    if (state.inBlock) {
      if (ch === "*" && next === "/") {
        state.inBlock = false;
        output += "  ";
        i += 2;
      } else {
        output += " ";
        i += 1;
      }
      continue;
    }

    if (quote) {
      output += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = undefined;
      }
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      output += " ".repeat(line.length - i);
      break;
    }

    if (ch === "/" && next === "*") {
      state.inBlock = true;
      output += "  ";
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    }

    output += ch;
    i += 1;
  }

  return output;
};

const isSourceFile = (path: string): boolean =>
  SOURCE_EXTENSIONS.has(extname(path));

const isProductionSourceFile = (path: string): boolean => {
  const parts = path.split("/");
  if (parts.some((part) => TEST_PATH_SEGMENTS.has(part))) return false;
  if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return false;
  return isSourceFile(path);
};

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return [path];
    }),
  );
  return files.flat();
};

const htmlFiles = async (dir: string): Promise<string[]> =>
  (await walk(dir)).filter((path) => path.endsWith(".html"));

const domainsFromHtml = (html: string): string[] =>
  uniqueSorted(
    Array.from(html.matchAll(/https?:\/\/([^/"'\s<>]+)/g), ([, host]) =>
      (host ?? "").toLowerCase(),
    ).filter(
      (host) =>
        host &&
        !host.includes("localhost") &&
        !IGNORED_FIXTURE_DOMAINS.has(host),
    ),
  );

const vendorClassesFromHtml = (html: string): string[] => {
  const classValues = Array.from(
    html.matchAll(/\bclass=(?:"([^"]+)"|'([^']+)')/g),
    ([, quoted, single]) => quoted ?? single ?? "",
  );
  return uniqueSorted(
    classValues
      .flatMap((value) => value.split(/\s+/))
      .filter((name) => /^(ashby-|_[a-z0-9]+_[a-z0-9]+_)/i.test(name)),
  );
};

export const fixtureSignalsFromHtmlFiles = async (
  testSiteDir: string,
): Promise<FixtureSignals> => {
  const files = await htmlFiles(testSiteDir);
  const htmlByFile = await Promise.all(
    files.map(async (path) => ({
      path,
      html: await Bun.file(path).text(),
    })),
  );

  return {
    fixtureFilenames: uniqueSorted(files.map((path) => basename(path))),
    fixtureStems: uniqueSorted(
      files.map((path) => basename(path, extname(path))),
    ),
    domains: uniqueSorted(
      htmlByFile.flatMap(({ html }) => domainsFromHtml(html)),
    ),
    vendorClasses: uniqueSorted(
      htmlByFile.flatMap(({ html }) => vendorClassesFromHtml(html)),
    ),
  };
};

const finding = (
  path: string,
  line: number,
  code: string,
  rule: string,
  message: string,
  matchIndex: number,
): GeneralizedFixtureFinding => ({
  path,
  line,
  column: matchIndex + 1,
  rule,
  message,
  excerpt: code.trim(),
});

const addStringFindings = (
  findings: GeneralizedFixtureFinding[],
  path: string,
  lineNumber: number,
  code: string,
  rule: string,
  messageFor: (value: string) => string,
  values: readonly string[],
) => {
  for (const value of values) {
    const index = code.toLowerCase().indexOf(value.toLowerCase());
    if (index >= 0) {
      findings.push(
        finding(path, lineNumber, code, rule, messageFor(value), index),
      );
    }
  }
};

export const checkGeneralizedFixtureText = (
  path: string,
  text: string,
  signals: FixtureSignals,
): GeneralizedFixtureFinding[] => {
  const findings: GeneralizedFixtureFinding[] = [];
  const state: CommentState = { inBlock: false };

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    if (hasAllowComment(rawLine)) return;

    const code = stripComments(rawLine, state);
    if (code.trim().length === 0) return;

    addStringFindings(
      findings,
      path,
      lineNumber,
      code,
      "fixture-filename",
      (value) =>
        `Production code references copied fixture filename "${value}". Generalize the behavior instead.`,
      signals.fixtureFilenames,
    );

    addStringFindings(
      findings,
      path,
      lineNumber,
      code,
      "fixture-domain",
      (value) =>
        `Production code references copied fixture domain "${value}". Do not target one copied website.`,
      signals.domains,
    );

    addStringFindings(
      findings,
      path,
      lineNumber,
      code,
      "fixture-vendor-class",
      (value) =>
        `Production code references copied vendor class "${value}". Prefer generic DOM/accessibility signals.`,
      signals.vendorClasses,
    );

    const uuidMatch = code.match(
      /["'`][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}["'`]/i,
    );
    if (uuidMatch?.index !== undefined) {
      findings.push(
        finding(
          path,
          lineNumber,
          code,
          "copied-field-id",
          "Production code contains a UUID-shaped string that looks like a copied field id.",
          uuidMatch.index,
        ),
      );
    }

    const copiedFieldNameMatch = code.match(/["'`]fld_\d+["'`]/i);
    if (copiedFieldNameMatch?.index !== undefined) {
      findings.push(
        finding(
          path,
          lineNumber,
          code,
          "copied-field-name",
          "Production code contains an opaque copied fixture field name.",
          copiedFieldNameMatch.index,
        ),
      );
    }

    if (SUSPICIOUS_CONTEXT.test(code)) {
      const terms = SITE_NAME_TERMS.filter((term) => term.length > 3);
      const termPattern = new RegExp(
        `["'\`][^"'\`]*\\b(?:${terms.map(escapeRegExp).join("|")})\\b[^"'\`]*["'\`]`,
        "i",
      );
      const siteNameMatch = code.match(termPattern);
      if (
        siteNameMatch?.index !== undefined ||
        (SITE_CONTEXT.test(code) &&
          terms.some((term) =>
            new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(code),
          ))
      ) {
        findings.push(
          finding(
            path,
            lineNumber,
            code,
            "site-specific-branch",
            "Production code appears to branch on a copied site or fixture name.",
            siteNameMatch?.index ?? 0,
          ),
        );
      }
    }
  });

  return findings;
};

export const checkGeneralizedFixtures = async (
  root = ".",
): Promise<GeneralizedFixtureFinding[]> => {
  const signals = await fixtureSignalsFromHtmlFiles(join(root, "test-site"));
  const sourceFiles = (await walk(join(root, "src")))
    .map((path) => relative(root, path))
    .filter(isProductionSourceFile);

  const findings = await Promise.all(
    sourceFiles.map(async (path) =>
      checkGeneralizedFixtureText(
        path,
        await Bun.file(join(root, path)).text(),
        signals,
      ),
    ),
  );

  return findings.flat();
};

if (import.meta.main) {
  const root = process.argv[2] ?? ".";
  const findings = await checkGeneralizedFixtures(root);

  if (findings.length > 0) {
    console.error("Fixture generalization check failed:");
    for (const item of findings) {
      console.error(
        `  - ${item.path}:${item.line}:${item.column} [${item.rule}] ${item.message}`,
      );
      console.error(`    ${item.excerpt}`);
    }
    process.exit(1);
  }

  console.log("Fixture generalization check passed.");
}
