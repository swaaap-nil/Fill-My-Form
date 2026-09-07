import { describe, expect, it } from "bun:test";
import {
  checkGeneralizedFixtureText,
  type FixtureSignals,
} from "../check-generalized-fixtures";

const signals: FixtureSignals = {
  fixtureFilenames: ["ibps-like.html", "supabase.html"],
  fixtureStems: ["ibps-like", "supabase"],
  domains: ["jobs.ashbyhq.com", "www.recaptcha.net"],
  vendorClasses: ["ashby-application-form-field-entry", "_fieldEntry_1e3gg_28"],
};

const rulesFor = (text: string): string[] =>
  checkGeneralizedFixtureText("src/lib/example.ts", text, signals).map(
    (finding) => finding.rule,
  );

describe("check-generalized-fixtures", () => {
  it("rejects copied fixture filenames in production code", () => {
    expect(rulesFor('const fixture = "supabase.html";')).toContain(
      "fixture-filename",
    );
  });

  it("rejects copied fixture domains in production code", () => {
    expect(rulesFor('const url = "https://jobs.ashbyhq.com/acme";')).toContain(
      "fixture-domain",
    );
  });

  it("rejects copied vendor classes in production code", () => {
    expect(
      rulesFor('root.querySelector(".ashby-application-form-field-entry");'),
    ).toContain("fixture-vendor-class");
  });

  it("rejects page-specific runtime branches", () => {
    expect(
      rulesFor('if (document.title.includes("Supabase")) return true;'),
    ).toContain("site-specific-branch");
  });

  it("rejects copied opaque field ids and names", () => {
    expect(
      rulesFor('const id = "5c60106e-bfac-4204-8e04-f490aceae780";'),
    ).toContain("copied-field-id");
    expect(rulesFor('if (field.name === "fld_7") return true;')).toContain(
      "copied-field-name",
    );
  });

  it("allows generic words and legitimate Supabase integration code", () => {
    expect(
      rulesFor(
        'import { createClient } from "@supabase/supabase-js";\nconst key = "documents.resume";',
      ),
    ).toEqual([]);
  });

  it("ignores comments and supports justified inline escapes", () => {
    expect(rulesFor('// if (origin.includes("ibps-like")) {}')).toEqual([]);
    expect(
      rulesFor(
        'const fixture = "supabase.html"; // fixture-generalization-allow: test harness names a fixture',
      ),
    ).toEqual([]);
  });
});
