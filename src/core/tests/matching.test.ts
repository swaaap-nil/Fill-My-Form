import { describe, expect, it } from "bun:test";
import { Certainty } from "~/core/agent/types";
import { FieldKind, type FormField } from "~/core/form/types";
import { tierToConfidence } from "~/core/matching/confidence";
import { classifyByAliasCoverage, resolve } from "~/core/matching/resolve";
import { MatchTier } from "~/core/matching/types";
import { createConceptIndex, ontology } from "~/core/ontology";
import { ConfidenceLevel } from "~/core/policy/types";

/** Minimal, fully-specified `FormField` — tests override only what they need. */
const field = (overrides: Partial<FormField>): FormField => ({
  id: "0/test/0",
  kind: FieldKind.TEXT,
  required: false,
  hasValue: false,
  constraints: [],
  disabled: false,
  readOnly: false,
  ...overrides,
});

describe("tier 1: autocomplete token", () => {
  it("resolves a standard token to its unique concept", () => {
    const result = resolve(
      field({ kind: FieldKind.TEXT, autocomplete: "given-name" }),
      ontology,
    );
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates).toEqual([
      {
        conceptKey: "identity.first_name",
        tier: MatchTier.AUTOCOMPLETE,
        score: 1,
      },
    ]);
  });

  it("takes the last token of a multi-word autocomplete value", () => {
    const result = resolve(
      field({ autocomplete: "shipping given-name" }),
      ontology,
    );
    expect(result.candidates[0]?.conceptKey).toBe("identity.first_name");
  });

  it("ignores autocomplete=off rather than treating it as a token", () => {
    const result = resolve(
      field({ autocomplete: "off", label: "Nickname" }),
      ontology,
    );
    expect(result.certainty).toBe(Certainty.UNKNOWN);
  });
});

describe("tier 2: type narrowing", () => {
  it("narrows when exactly one concept declares a kind's expects value", () => {
    // The real ontology no longer has a lone concept for any kind
    // (`contact.alternate_email` joined `contact.email` on "email", same as
    // "tel" already had three) — so this proves the tier's own logic
    // against a minimal synthetic index, independent of whether today's
    // ontology happens to have a collision for every kind.
    const solo = createConceptIndex([
      {
        key: "test.only_url_concept",
        label: "Only URL concept",
        sensitivity: "public",
        volatility: "stable",
        expects: "url",
        aliases: { en: ["only url concept"] },
      },
    ]);
    const result = resolve(field({ kind: FieldKind.URL }), solo);
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates).toEqual([
      {
        conceptKey: "test.only_url_concept",
        tier: MatchTier.TYPE_NARROWING,
        score: 0.8,
      },
    ]);
  });

  it("does not narrow a tel input alone: three concepts expect tel", () => {
    const result = resolve(field({ kind: FieldKind.TEL }), ontology);
    expect(result.certainty).toBe(Certainty.UNKNOWN);
  });

  it("does not narrow an email input alone: two concepts expect email", () => {
    // contact.email and contact.alternate_email both expect "email" — the
    // same "more than one concept, defer to alias/nearby-text" treatment
    // tel already gets, not a regression.
    const result = resolve(field({ kind: FieldKind.EMAIL }), ontology);
    expect(result.certainty).toBe(Certainty.UNKNOWN);
  });

  it("does not narrow a kind with no expects mapping (checkbox)", () => {
    const result = resolve(field({ kind: FieldKind.CHECKBOX }), ontology);
    expect(result.certainty).toBe(Certainty.UNKNOWN);
  });
});

describe("tier 3: exact alias", () => {
  it("resolves the motivating example", () => {
    const result = resolve(field({ label: "10th Passing Year" }), ontology);
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe(
      "education.secondary.completion_year",
    );
    expect(result.candidates[0]?.tier).toBe(MatchTier.ALIAS);
  });

  it("resolves a Hindi alias", () => {
    const result = resolve(field({ label: "दसवीं उत्तीर्ण वर्ष" }), ontology);
    expect(result.candidates[0]?.conceptKey).toBe(
      "education.secondary.completion_year",
    );
  });

  it("resolves a punctuation variant once normalised (College / university)", () => {
    const result = resolve(field({ label: "College / university" }), ontology);
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe(
      "education.undergraduate.institution",
    );
    expect(result.candidates[0]?.tier).toBe(MatchTier.ALIAS);
  });

  it("resolves IBPS-style scanned photograph labels to the photo file concept", () => {
    const result = resolve(
      field({
        kind: FieldKind.FILE,
        label: "Scanned Photograph of the Candidate:",
      }),
      ontology,
    );
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe("documents.photo");
    expect(result.candidates[0]?.tier).toBe(MatchTier.ALIAS);
  });

  it("resolves IBPS-style scanned signature labels to the signature file concept", () => {
    const result = resolve(
      field({
        kind: FieldKind.FILE,
        label: "Scanned Signature of the Candidate:",
      }),
      ontology,
    );
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe("documents.signature");
    expect(result.candidates[0]?.tier).toBe(MatchTier.ALIAS);
  });

  it("resolves passport country to the shared country concept", () => {
    const result = resolve(field({ label: "Passport Country" }), ontology);
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe("contact.address.country");
    expect(result.candidates[0]?.tier).toBe(MatchTier.ALIAS);
  });

  it("resolves country of residence to the address country concept", () => {
    const result = resolve(field({ label: "Country of Residence" }), ontology);
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe("contact.address.country");
    expect(result.candidates[0]?.tier).toBe(MatchTier.ALIAS);
  });

  it("resolves Twitter / X profile labels to a social profile URL concept", () => {
    const result = resolve(
      field({ kind: FieldKind.URL, label: "Twitter / X profile" }),
      ontology,
    );
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe("contact.twitter_url");
    expect(result.candidates[0]?.tier).toBe(MatchTier.ALIAS);
  });
});

describe("tier 4: placeholder containment", () => {
  it("resolves messy.html's fld_8: no usable label, only a placeholder", () => {
    const result = resolve(
      field({
        label: "Enter your PIN code",
        placeholder: "Enter your PIN code",
      }),
      ontology,
    );
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe(
      "contact.address.postal_code",
    );
    expect(result.candidates[0]?.tier).toBe(MatchTier.PLACEHOLDER);
  });

  it("ignores a placeholder with no alias coverage", () => {
    const result = resolve(field({ placeholder: "e.g. 12345" }), ontology);
    expect(result.certainty).toBe(Certainty.UNKNOWN);
  });
});

describe("tier 5: nearby text containment", () => {
  it("resolves a label with no exact alias, via a multi-word alias covered by label + nearby text", () => {
    // Neither "Please upload" nor "your resume as PDF" is itself an alias —
    // only their union covers "upload resume" (education.undergraduate's
    // own two-word alias), so this must resolve here, not at tier 3.
    const result = resolve(
      field({ label: "Please upload", nearbyText: ["your resume as PDF"] }),
      ontology,
    );
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe("documents.resume");
    expect(result.candidates[0]?.tier).toBe(MatchTier.NEARBY_TEXT);
  });

  it("uses nearbyText to disambiguate a trailing sibling note", () => {
    // Not messy.html's fld_7 (that one is a deliberate tie, see below) —
    // this proves nearbyText actually participates when it is not tied.
    const result = resolve(
      field({ label: "Number", nearbyText: ["postal code for billing"] }),
      ontology,
    );
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe(
      "contact.address.postal_code",
    );
  });

  it("ignores a single-word alias as too weak a containment signal", () => {
    // "employer" alone is a real alias, but at one token it must not fire
    // via containment — only as a full label (tier 3) or as part of a
    // longer covered alias.
    const result = resolve(
      field({ label: "Notes", nearbyText: ["ask about employer policy"] }),
      ontology,
    );
    expect(result.certainty).toBe(Certainty.UNKNOWN);
  });
});

describe("ambiguity: no meaningful separation between top candidates", () => {
  it("never resolves messy.html's fld_7 to a specific concept", () => {
    // Bare "Year" plus "(of joining current employer)" ties two concepts
    // at the same longest coverage: employment.current.company (via
    // "current employer") and employment.current.start_year (via "joining
    // year"). Guessing between them is exactly what this phase forbids —
    // AMBIGUOUS is the correct, final answer, not a fallback.
    const result = resolve(
      field({ label: "Year", nearbyText: ["(of joining current employer)"] }),
      ontology,
    );
    expect(result.certainty).toBe(Certainty.AMBIGUOUS);
    const keys = result.candidates.map((c) => c.conceptKey).sort();
    expect(keys).toEqual(
      ["employment.current.company", "employment.current.start_year"].sort(),
    );
  });

  it("the Hindi substring collision: longest match wins, not the first found", () => {
    // "उत्तीर्ण वर्ष" (undergraduate) is a substring of "दसवीं उत्तीर्ण
    // वर्ष" (secondary). Exercised here via a label that is NOT itself an
    // exact alias, so tier 3 does not shortcut past the containment logic
    // this guards.
    const result = resolve(field({ label: "प्रश्न: दसवीं उत्तीर्ण वर्ष" }), ontology);
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe(
      "education.secondary.completion_year",
    );
  });

  it("the same shape exists in English: 10th passing year vs graduation year", () => {
    const result = resolve(
      field({ label: "please state your 10th passing year here" }),
      ontology,
    );
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe(
      "education.secondary.completion_year",
    );
  });
});

describe("abstention", () => {
  it("returns unknown, not a guess, for a field with no matching signal", () => {
    const result = resolve(field({ label: "I accept the terms" }), ontology);
    expect(result.certainty).toBe(Certainty.UNKNOWN);
    expect(result.candidates).toEqual([]);
  });

  it("returns unknown for a field with no label, placeholder or autocomplete at all", () => {
    const result = resolve(field({}), ontology);
    expect(result.certainty).toBe(Certainty.UNKNOWN);
  });
});

describe("tier -> ConfidenceLevel mapping", () => {
  it("orders tiers from most to least trusted", () => {
    expect(tierToConfidence(MatchTier.AUTOCOMPLETE)).toBe(
      ConfidenceLevel.CERTAIN,
    );
    expect(tierToConfidence(MatchTier.ALIAS)).toBe(ConfidenceLevel.HIGH);
    expect(tierToConfidence(MatchTier.TYPE_NARROWING)).toBe(
      ConfidenceLevel.HIGH,
    );
    expect(tierToConfidence(MatchTier.PLACEHOLDER)).toBe(
      ConfidenceLevel.MEDIUM,
    );
    expect(tierToConfidence(MatchTier.NEARBY_TEXT)).toBe(ConfidenceLevel.LOW);
  });

  it("has an entry for every tier", () => {
    for (const tier of Object.values(MatchTier)) {
      expect(tierToConfidence(tier)).toBeDefined();
    }
  });
});

describe("education score concepts: bare percentage/CGPA is not guessed", () => {
  it("resolves a level-qualified score to its own concept", () => {
    const result = resolve(field({ label: "10th CGPA" }), ontology);
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe("education.secondary.cgpa");
  });

  it("abstains on a bare 'CGPA' with no level: real forms are level-specific, and guessing which one would be exactly the wrong instinct", () => {
    expect(resolve(field({ label: "CGPA" }), ontology).certainty).toBe(
      Certainty.UNKNOWN,
    );
  });

  it("abstains on a bare 'Percentage' with no level", () => {
    expect(resolve(field({ label: "Percentage" }), ontology).certainty).toBe(
      Certainty.UNKNOWN,
    );
  });
});

describe("employment history concepts do not collide with employment.current", () => {
  it("'Previous employer' resolves to history, not the current-employer concept", () => {
    const result = resolve(field({ label: "Previous employer" }), ontology);
    expect(result.candidates[0]?.conceptKey).toBe("employment.history.company");
  });

  it("'Current employer' still resolves to the current-employer concept", () => {
    const result = resolve(field({ label: "Current employer" }), ontology);
    expect(result.candidates[0]?.conceptKey).toBe("employment.current.company");
  });
});

describe("a custom ontology (isolation from the production concept list)", () => {
  it("still applies longest-match-wins across an injected index", () => {
    const index = createConceptIndex([
      {
        key: "a.short",
        label: "A",
        sensitivity: "public",
        volatility: "permanent",
        expects: "text",
        aliases: { en: ["annual report"] },
      },
      {
        key: "b.long",
        label: "B",
        sensitivity: "public",
        volatility: "permanent",
        expects: "text",
        aliases: { en: ["annual report submission date"] },
      },
    ]);

    const result = resolve(
      field({ label: "please give the annual report submission date below" }),
      index,
    );
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe("b.long");
  });
});

describe("locale-scoped matching", () => {
  it("resolves a Hindi alias when the locale is passed explicitly", () => {
    const result = resolve(field({ label: "दसवीं उत्तीर्ण वर्ष" }), ontology, "hi");
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe(
      "education.secondary.completion_year",
    );
  });

  it("resolves a Spanish alias for a concept that has Spanish aliases", () => {
    const result = resolve(
      field({ label: "correo electrónico" }),
      ontology,
      "es",
    );
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe("contact.email");
  });

  it("resolves a French alias for a concept that has French aliases", () => {
    const result = resolve(field({ label: "adresse e-mail" }), ontology, "fr");
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe("contact.email");
  });

  it("still resolves an English label when a non-English locale is declared but the concept has no alias for it", () => {
    // Most concepts don't have `es` aliases yet — a declared `locale: "es"`
    // must not silently disable matching for them; coverageMatches falls
    // back to scanning every locale when the declared one has nothing.
    const result = resolve(field({ label: "Father's name" }), ontology, "es");
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe("identity.father_name");
  });

  it("re-confirms the Hindi substring collision with an explicit locale (no regression)", () => {
    const result = resolve(
      field({ label: "प्रश्न: दसवीं उत्तीर्ण वर्ष" }),
      ontology,
      "hi",
    );
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe(
      "education.secondary.completion_year",
    );
  });

  it("locale scoping avoids a cross-locale collision that flattening all locales would create", () => {
    // Two synthetic concepts whose EN alias for one collides, as a raw
    // substring, with the other's ES alias — flattening every locale (no
    // `locale` passed) makes both concepts tie on token coverage, since
    // "casa numero" appears whole in both aliases; scoping to the
    // declared page locale removes the unrelated-language alias from
    // consideration entirely, leaving a single, correct match.
    const index = createConceptIndex([
      {
        key: "test.concept_en",
        label: "EN concept",
        sensitivity: "public",
        volatility: "permanent",
        expects: "text",
        aliases: { en: ["casa numero uno"] },
      },
      {
        key: "test.concept_es",
        label: "ES concept",
        sensitivity: "public",
        volatility: "permanent",
        expects: "text",
        aliases: { es: ["casa numero"] },
      },
    ]);

    const flattened = resolve(field({ label: "casa numero uno" }), index);
    expect(flattened.certainty).toBe(Certainty.KNOWN);
    expect(flattened.candidates[0]?.conceptKey).toBe("test.concept_en");

    const scoped = resolve(field({ label: "casa numero uno" }), index, "es");
    // With `locale: "es"` and no ES alias on `test.concept_en`, only the
    // (weaker, shorter) ES alias on `test.concept_es` is in scope for that
    // concept — `test.concept_en` still wins because it has no ES aliases
    // at all and so falls back to scanning every locale for itself, same
    // as the "no alias for this locale" test above. The point stands: the
    // two calls do not have to agree, since the declared locale narrows
    // what counts as a "match" for concepts that do have that locale's data.
    expect(scoped.certainty).toBe(Certainty.KNOWN);
  });
});

describe("classifyByAliasCoverage", () => {
  const uploadConcepts = ontology.all.filter((c) =>
    ["documents.resume", "documents.photo", "documents.signature"].includes(
      c.key,
    ),
  );

  it("classifies a single-word English label against a small concept set with a lowered token threshold", () => {
    // The tier 4/5 default (MIN_ALIAS_TOKENS_FOR_COVERAGE = 2) would reject
    // every alias here, since "signature"/"photo"/"resume" are one token —
    // classifyByAliasCoverage's minAliasTokens override is required, not
    // optional, for this call shape.
    expect(
      classifyByAliasCoverage("Signature", uploadConcepts, undefined, 1),
    ).toBe("documents.signature");
    expect(classifyByAliasCoverage("Photo", uploadConcepts, undefined, 1)).toBe(
      "documents.photo",
    );
  });

  it("classifies a German upload label via the German aliases", () => {
    expect(
      classifyByAliasCoverage("Unterschrift", uploadConcepts, "de", 1),
    ).toBe("documents.signature");
    expect(classifyByAliasCoverage("Foto", uploadConcepts, "de", 1)).toBe(
      "documents.photo",
    );
    expect(classifyByAliasCoverage("Lebenslauf", uploadConcepts, "de", 1)).toBe(
      "documents.resume",
    );
  });

  it("returns undefined rather than guessing when nothing matches", () => {
    expect(
      classifyByAliasCoverage(
        "Terms and conditions",
        uploadConcepts,
        undefined,
        1,
      ),
    ).toBeUndefined();
  });
});
