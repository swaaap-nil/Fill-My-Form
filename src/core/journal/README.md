# `journal/` — the local record of what the matcher couldn't resolve

Every field `~/core/matching` leaves `unknown` or `ambiguous` gets recorded
here. This is how the ontology grows against reality instead of against
guesses: the top unmatched labels, ranked by how often people actually hit
them, are the next aliases and concepts to add.

**Local only in v1.** Nothing here is transmitted, no consent is required, no
backend exists. Phase 8 adds the consent prompt that unlocks *sending* what is
already being collected here — by which point the screening logic has been
proven in production for months, not shipped alongside the upload channel
that first needs it.

## Screening happens at write time

A label can carry interpolated personal data — "Confirm email for
ananya@example.com" is a label. `createFieldJournal().record()` checks the raw
signal against the caller's own stored values before writing anything; a match
drops the sighting entirely rather than attempting to redact it in place.
Screening at write time, rather than at send time, means the corpus is clean
by construction and the guarantee is proven long before Phase 8 gives it
anywhere to go.

## The schema is a narrowing, not a redaction

`UnresolvedField` is built by picking the signals worth keeping — origin,
`fieldKey`, normalised label, kind, tiers tried, certainty, a count and a
timestamp — never by stripping fields off a richer object. A redaction fails
open the day someone adds a field to the richer object; a narrowing fails
closed because the type itself has nowhere for anything else to go. Same
discipline as `LogFields` (`~/core/logging`) and the precursor to ADR 007's
`SiteObservation`.

## What lands here next

An IndexedDB-backed implementation of `FieldJournal` (the in-memory one here
is the same story as `MemoryStore`'s: good for tests, not for production), a
panel view so the user can see and wipe it, and — Phase 8 — the consent
prompt and upload channel ADR 007 describes.
