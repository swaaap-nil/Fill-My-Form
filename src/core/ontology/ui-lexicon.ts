/**
 * Small, bounded vocabulary for generic form-UI affordances (upload
 * buttons, submit verbs, native file-picker chrome text) — distinct from
 * `concepts.json`, which maps *personal-data field* labels to concepts.
 * "Browse" and "Submit" describe no personal-data concept, so they live
 * here instead, keyed by locale the same way `Concept.aliases` is.
 */

import { normaliseLabel } from "./index";
import lexiconRaw from "./ui-lexicon.json";

export type LexiconCategory =
  | "uploadAffordance"
  | "submitVerbs"
  | "genericFilePickerText";

type Lexicon = Record<LexiconCategory, Record<string, readonly string[]>>;

const lexicon = lexiconRaw as Lexicon;

const phrasesFor = (
  category: LexiconCategory,
  locale?: string,
): readonly string[] => {
  const localePhrases = locale ? lexicon[category][locale] : undefined;
  return localePhrases ?? Object.values(lexicon[category]).flat();
};

/**
 * Does `text` contain any lexicon phrase for `category`, case- and
 * accent-insensitively (via `normaliseLabel`)? Scoped to `locale` when
 * given and populated, otherwise checked against every locale.
 */
export const containsLexiconPhrase = (
  category: LexiconCategory,
  text: string,
  locale?: string,
): boolean => {
  const normalised = normaliseLabel(text);
  if (!normalised) return false;
  return phrasesFor(category, locale).some((phrase) =>
    normalised.includes(normaliseLabel(phrase)),
  );
};

/**
 * Does `text`, once normalised, equal exactly one lexicon phrase for
 * `category`? Used to suppress native file-picker chrome text ("Choose
 * File", "No file chosen") from leaking into a field's resolved label.
 */
export const isExactLexiconPhrase = (
  category: LexiconCategory,
  text: string,
  locale?: string,
): boolean => {
  const normalised = normaliseLabel(text);
  if (!normalised) return false;
  return phrasesFor(category, locale).some(
    (phrase) => normaliseLabel(phrase) === normalised,
  );
};
