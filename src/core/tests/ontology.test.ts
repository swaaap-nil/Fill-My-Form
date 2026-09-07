import { describe, expect, it } from "bun:test";
import {
  concepts,
  createConceptIndex,
  normaliseLabel,
  ontology,
  ontologySchema,
} from "~/core/ontology";

describe("ontology data", () => {
  it("parses concepts.json against the schema", () => {
    expect(() => ontologySchema.parse(concepts)).not.toThrow();
    expect(concepts.length).toBeGreaterThan(0);
  });

  it("has unique concept keys", () => {
    const keys = concepts.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every concept at least one English alias", () => {
    for (const concept of concepts) {
      expect(concept.aliases.en?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("normaliseLabel", () => {
  it("collapses case, punctuation and separators", () => {
    expect(normaliseLabel("10th Passing Year *")).toBe("10th passing year");
    expect(normaliseLabel("  E-mail__Address ")).toBe("e mail address");
  });

  it("preserves non-Latin scripts", () => {
    expect(normaliseLabel("दसवीं उत्तीर्ण वर्ष")).toBe("दसवीं उत्तीर्ण वर्ष");
  });
});

describe("alias lookup", () => {
  it("resolves the motivating example deterministically, no model involved", () => {
    expect(ontology.byAlias("10th Passing Year")?.key).toBe(
      "education.secondary.completion_year",
    );
  });

  it("resolves a Hindi alias", () => {
    expect(ontology.byAlias("दसवीं उत्तीर्ण वर्ष")?.key).toBe(
      "education.secondary.completion_year",
    );
  });

  it("resolves IBPS upload aliases", () => {
    expect(ontology.byAlias("Scanned Photograph of the Candidate:")?.key).toBe(
      "documents.photo",
    );
    expect(ontology.byAlias("Scanned Signature of the Candidate:")?.key).toBe(
      "documents.signature",
    );
  });

  it("returns undefined rather than a best guess", () => {
    expect(ontology.byAlias("favourite colour")).toBeUndefined();
  });

  it("prefers the requested locale when an alias is shared", () => {
    const index = createConceptIndex([
      {
        key: "a.one",
        label: "A",
        sensitivity: "public",
        volatility: "permanent",
        expects: "text",
        aliases: { en: ["shared"] },
      },
      {
        key: "b.two",
        label: "B",
        sensitivity: "public",
        volatility: "permanent",
        expects: "text",
        aliases: { hi: ["shared"] },
      },
    ]);

    expect(index.byAlias("shared", "hi")?.key).toBe("b.two");
    expect(index.byAlias("shared", "en")?.key).toBe("a.one");
  });
});
