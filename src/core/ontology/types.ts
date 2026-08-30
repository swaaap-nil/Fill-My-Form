import { z } from "zod";

/**
 * How carefully a concept must be handled. Drives policy: see `~/core/policy`.
 * Sensitivity is a property of the *concept*, so it is declared here, once,
 * in data — not re-derived at every call site.
 */
export const Sensitivity = {
  /** Not personal. Safe to fill without asking. */
  PUBLIC: "public",
  /** Personal but low-stakes: name, email. */
  PERSONAL: "personal",
  /** Personal and identifying: date of birth, address. */
  SENSITIVE: "sensitive",
  /** Never auto-filled: government ids, financial, health, credentials. */
  RESTRICTED: "restricted",
} as const;

export type Sensitivity = (typeof Sensitivity)[keyof typeof Sensitivity];

/** BCP-47-ish language tags for alias sets. Extend as locales are added. */
export const conceptSchema = z.object({
  /** Canonical dotted key, e.g. "education.secondary.completion_year". */
  key: z.string().regex(/^[a-z0-9]+(\.[a-z0-9_]+)+$/),
  label: z.string().min(1),
  sensitivity: z.enum([
    Sensitivity.PUBLIC,
    Sensitivity.PERSONAL,
    Sensitivity.SENSITIVE,
    Sensitivity.RESTRICTED,
  ]),
  /** Hint for the expected FormIR field kind. Advisory, not a constraint. */
  expects: z.enum([
    "text",
    "email",
    "tel",
    "url",
    "number",
    "date",
    "select",
    "file",
  ]),
  /**
   * Surface forms seen on real forms, keyed by language. These drive the
   * deterministic and keyword matching tiers before any model is consulted.
   */
  aliases: z.record(z.string(), z.array(z.string().min(1))),
});

export type Concept = z.infer<typeof conceptSchema>;

export const ontologySchema = z.array(conceptSchema);

export interface ConceptIndex {
  readonly all: readonly Concept[];
  byKey(key: string): Concept | undefined;
  /** Exact, case- and punctuation-insensitive alias lookup. Tier 2 matching. */
  byAlias(text: string, locale?: string): Concept | undefined;
}
