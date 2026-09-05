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

/**
 * How quickly a stored value stops being true. Like `sensitivity`, this belongs
 * to the *concept* and is declared here, once, in data.
 *
 * The class says how a concept behaves; how long each class is trusted is
 * policy and lives in a separately tunable duration table, because "how long do
 * we trust an employer" is an operational decision and adding a concept is a
 * code change. See ADR 006.
 */
export const Volatility = {
  /** Never goes stale. Date of birth, a completed degree's year. */
  PERMANENT: "permanent",
  /** Changes rarely and deliberately. Full name, nationality. */
  STABLE: "stable",
  /** Changes every few years. City, postal code, phone. */
  SLOW: "slow",
  /** Changes on its own schedule. Employer, job title, income. */
  VOLATILE: "volatile",
  /**
   * The value *is* a date and expires when it says it does — a passport
   * expiry. Its horizon is the value itself, minus a lead time, so the user is
   * asked before it lapses rather than after.
   */
  SELF_DATED: "self_dated",
} as const;

export type Volatility = (typeof Volatility)[keyof typeof Volatility];

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
  /**
   * How long a stored value is trusted before the user is asked to confirm it.
   * Required, and deliberately so: an omitted horizon is how a stale employer
   * gets filled into a visa application two years later.
   */
  volatility: z.enum([
    Volatility.PERMANENT,
    Volatility.STABLE,
    Volatility.SLOW,
    Volatility.VOLATILE,
    Volatility.SELF_DATED,
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
  /**
   * WHATWG `autocomplete` token(s) that identify this concept with the
   * highest precision available and zero string-matching cost — an
   * `autocomplete="given-name"` attribute is a stronger signal than any
   * label text. Optional: most concepts (government ids, employer, most
   * education fields) have no standard token. See `~/core/matching`, tier 1.
   */
  autocomplete: z.array(z.string().min(1)).optional(),
});

export type Concept = z.infer<typeof conceptSchema>;

export const ontologySchema = z.array(conceptSchema);

export interface ConceptIndex {
  readonly all: readonly Concept[];
  byKey(key: string): Concept | undefined;
  /** Exact, case- and punctuation-insensitive alias lookup. Tier 2 matching. */
  byAlias(text: string, locale?: string): Concept | undefined;
}
