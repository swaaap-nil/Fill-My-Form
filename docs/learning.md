# Learning from failure

Not built. This is the intended design, so that the pieces already in place —
`VerificationIssue`, the ontology, provenance — are not built in a way that
forecloses it. The boundary it runs on is
[ADR 007](./adr/007-shared-site-knowledge.md).

## Most of "why did this fail" is arithmetic

When a page rejects a fill, the temptation is to hand the whole situation to a
model and ask what went wrong. Nearly all of it is decidable without one, because
we know what the page *said*, what we *sent*, and what happened.

| Cause | How we know | Whose problem |
|---|---|---|
| `STATED_CONSTRAINT_VIOLATED` | We sent 120 KB against a stated 100 KB | Ours. A bug, not a discovery |
| `CONSTRAINT_STRICTER_THAN_STATED` | Stated 49 KB, rejected at 48.7 KB | The site's. High-value fact |
| `UNDOCUMENTED_CONSTRAINT` | Rejected, and we found no stated constraint | The site's. High-value fact |
| `FORMAT_REJECTED` | Value shape refused — date order, phone country code | The site's, usually fixable |
| `VALUE_DISPUTED` | Page asserts the value itself is wrong | Possibly the *memory's* |
| `SESSION_STATE` | Expired session, CSRF, rate limit | Neither. Not about the value |
| `TRANSIENT` | 5xx, network | Neither. Retry |
| `UNKNOWN` | Everything left | The only one worth a model call |

Building this table is the point. A model asked "why did this fail" will produce
a fluent answer for every row, including the rows that are arithmetic, and it
will be wrong often enough to poison anything we store. The model gets the
residual, not the question.

`VALUE_DISPUTED` is the interesting one: if a portal says a passport number fails
its checksum, the most likely explanation is that our stored value is wrong. That
is not a site fact — it is a reason to drop the value's confidence and ask the
user, through the freshness path in
[ADR 006](./adr/006-value-freshness-and-expiry.md). Failure feeding memory
staleness is the only case where this loop points inward.

## "Was it just me?" is not a question one device can answer

One device has a sample size of one. It cannot distinguish "this form rejects
everyone's 48 KB upload" from "my session expired." Asking a model to guess
produces confident noise.

So the device contributes an observation and no conclusion, and the service
decides once k independent devices have seen the same thing. This is also what
makes the contribution safe to send: a fact k strangers all hit is, by
construction, not about any of them.

```
fill fails
   ↓  classify deterministically        (the table above)
   ↓  if UNKNOWN, one model call        (the residual only)
   ↓  narrow to a SiteObservation       (closed schema, screened against memory)
   ↓  batch, delay, send anonymously    (ADR 007)
service corroborates across k devices
   ↓  publishes a hint
every device fills that form deterministically, forever
```

The payoff is that token cost falls as adoption rises. The first user of a form
pays for discovery; nobody else does.

## Unresolved fields are the compatibility engine

The most valuable thing this product can learn is not why a fill failed. It is **which fields it
has never seen before**.

Every time the deterministic tiers abstain, that is a label the ontology does not cover. Recorded
and counted, those abstentions sort themselves into a work queue: the most frequently hit
unknown label is, by definition, the next alias or concept worth adding. Add it, and every
device that meets that field again resolves it deterministically — no model call, no question to
the user, permanently.

That loop is what makes compatibility compound instead of plateau:

```
matcher abstains
   ↓  record the non-personal signals locally    (Phase 1b, no consent needed)
   ↓  after consent, contribute                  (Phase 8)
service ranks unresolved labels by frequency
   ↓  add the top N as aliases or concepts
every device fills those fields deterministically, forever
```

The ordering matters. Collecting locally from the first day the matcher exists means that by the
time anything can be transmitted there is already a corpus, the screening logic has been in use
for months, and the schema has been exercised — rather than all three being new on the day the
network path opens.

What is recorded is the shape of the miss, never the user: a normalised label, the origin, the
field kind, an autocomplete token, which tiers were tried. Built by narrowing into a closed
schema, and screened against the user's own memory before it is even written to disk — a label
like "Confirm email for ananya@example.com" is a label, and the client is the only party holding
both halves.

## Multilingual coverage comes out of the same pipe

Hand-curating aliases in `concepts.json` works for English and Hindi and does not
scale to the world. But the deterministic-first design already produces exactly
what is needed: when a label matches nothing, the model's job is to emit a
canonical concept key, and the pair it produces — *this surface form* means
`education.undergraduate.completion_year` — is a fact about a public web page in
a public language. It contains no personal data, and it is identical for every
user who sees that form.

Corroborated across devices, it becomes an alias for everyone. The ontology then
grows from usage, in languages nobody on the team reads, without anyone
curating Vietnamese by hand.

Two cautions:

**Labels are page text, and page text is sometimes personal.** "Confirm email for
ananya@example.com" is a label. The client screens candidate aliases against the
user's own stored values before sending — it is the only party holding both
halves — and drops anything that matches or that looks like an identifier.

**A corroborated alias is still only a hint.** It reorders matching tiers. It
cannot alter a concept's `sensitivity` or `volatility`, and it cannot cause a
first fill without confirmation. A poisoned alias should be able to waste a model
call, never to redirect a passport number.

## Issue reports in languages we do not read

The answer is not translation. It is not needing prose.

A report is structured by construction: a category the user picks from a list
rendered in their language, transmitted as a language-independent enum, plus the
context the client already has in non-personal form — origin, `formKey`,
`issueCode`, agent phase, whether verification failed and how. That triages
without anyone reading a word of Vietnamese, because the failure taxonomy is
structural rather than linguistic. "`field_invalid` on a file field at this
origin, observed limit 48 KB" means the same thing in every language.

Free text stays optional, is clearly marked as leaving the device, is screened
against memory the same way, and is translated only when the structured part is
not enough. Design so that it usually is.

## The four things worth tracking, and the rule that makes them safe

Per-site issues, analytics, per-form success rate, user ratings — every one of
them is an aggregate over **sites**, not over **users**.

- **Success rate**: of fills attempted on this form, what fraction completed
  without a verification failure. Keyed by `(origin, formKey)`.
- **Per-site issues**: the corroborated observations above, ranked by frequency.
- **Ratings**: `(origin, formKey, score)`. A rating is about a form, not a person.
- **Analytics**: counts and durations, under the existing `LogFields` allowlist.

The rule: **if a number cannot be computed without a per-user record, it is not
collected.** "37% of users have a stale employer" fails that test. "This form
fails verification 12% of the time" passes it.

That rule is what keeps a dashboard from quietly becoming the browsing-history
database that [ADR 007](./adr/007-shared-site-knowledge.md) exists to prevent.
