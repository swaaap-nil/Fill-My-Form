import raw from "./concepts.json";
import { type Concept, type ConceptIndex, ontologySchema } from "./types";

export * from "./types";

/**
 * Normalises a surface form for exact alias matching: lowercase, punctuation
 * and separators collapsed to single spaces. "10th Passing Year *" and
 * "10th  passing-year" both become "10th passing year".
 */
export const normaliseLabel = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[_\-/\\]+/g, " ")
    // \p{M} keeps combining marks: without it Devanagari matras are
    // stripped and "दसवीं" collapses to "दसव".
    .replace(/[^\p{L}\p{M}\p{N} ]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();

export const createConceptIndex = (
  concepts: readonly Concept[],
): ConceptIndex => {
  const byKey = new Map(concepts.map((c) => [c.key, c]));

  // "locale alias" -> concept, plus a locale-agnostic entry.
  const byAlias = new Map<string, Concept>();
  for (const concept of concepts) {
    for (const [locale, aliases] of Object.entries(concept.aliases)) {
      for (const alias of aliases) {
        const normalised = normaliseLabel(alias);
        byAlias.set(`${locale} ${normalised}`, concept);
        if (!byAlias.has(normalised)) byAlias.set(normalised, concept);
      }
    }
  }

  return {
    all: concepts,
    byKey: (key) => byKey.get(key),
    byAlias: (text, locale) => {
      const normalised = normaliseLabel(text);
      return (
        (locale ? byAlias.get(`${locale} ${normalised}`) : undefined) ??
        byAlias.get(normalised)
      );
    },
  };
};

/** Throws at import time if `concepts.json` is malformed. */
export const concepts: readonly Concept[] = ontologySchema.parse(raw);

export const ontology: ConceptIndex = createConceptIndex(concepts);
