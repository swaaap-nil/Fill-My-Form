# 005 — Nothing reads the inside of a document

**Status:** accepted · 2026-09-04

## Context

Indian government and university forms routinely ask for the same information
twice: a passport *number* as a text field, and a passport *scan* as an upload.
The same is true of degree certificates, PAN cards and employment letters.

The obvious feature is to read the number off the scan. Every path to it is
available: a cloud vision model, an on-device model through Chrome's built-in
Prompt API, or Tesseract compiled to WASM and bundled. The middle two keep the
bytes on the device, so they look compatible with the privacy claim.

Users are least comfortable handing over exactly these files. "It only reads them
locally" is a claim they cannot check, and it is one hotfix away from being
false.

## Decision

No tool reads the content of a user's file. Not a cloud model, not an on-device
model, not bundled OCR. The capability does not exist in the tool surface.

Two independent paths replace it:

**Values are typed, once.** An unresolved text field becomes an `ask_user`
question. The user types their passport number one time; it is stored under
`identity.passport_number` with `source: user_provided`, and every later form
resolves it through alias matching with no model and no file access. The number
and the document are permanently separate concepts, because the number was never
sourced from the document.

**Files are tagged, once.** An upload field resolves to a *file reference*, not
to file content. The user tags a file once ("this is my passport document"),
which stores a `MemoryItem` whose value is a reference under a `file`-typed
concept such as `documents.passport`. Resolution uses the same `ConceptIndex`
and the same alias tiers as any text concept. The agent learns which file
answers the field and never opens it.

Making a file *fit* a form — crop to 35×45mm, recompress under 100 KB — stays
allowed, because it is pixel and byte work that never interprets meaning. It runs
on canvas in the tab, and the original is not modified.

`MemorySource.IMPORTED_DOCUMENT` ("extracted from a document the user supplied")
encodes the capability this ADR refuses, and is removed.

## Alternatives

**On-device OCR (Tesseract WASM, or Chrome's built-in model).** Bytes never leave
the device, so it satisfies the letter of the privacy boundary. Rejected on the
strength of the claim rather than the mechanics: "it reads your documents, but
only locally" requires the user to trust an implementation detail, where "it
cannot read your documents" is a property they can verify by looking for the
tool and not finding it. It also adds a multi-megabyte WASM payload to an
extension bundle we want reviewable.

**Cloud vision.** Best extraction quality by a wide margin, and flatly
incompatible with the product.

**On-device OCR behind explicit per-document consent.** The defensible version of
the first option, and the one to revisit if this decision is ever wrong. Rejected
now because the benefit it buys — saving the user one typing event per document,
ever — does not justify the capability existing at all.

## Consequences

Good:

- The privacy claim becomes absolute and checkable: there is no code path from
  file bytes to anything that interprets them. It survives a hostile reading of
  the source, which "we only do it locally" does not.
- No OCR dependency, no WASM payload, no extraction confidence to model, no
  wrong-value-from-a-blurry-scan failure mode.
- File handling collapses into the mechanism that already exists. A file concept
  is a `MemoryItem` with a reference for a value; it needs no second retrieval
  path, no second confirmation flow and no second policy rule.

Bad:

- The user types each document-derived value once. This is a real cost on first
  use of a form-heavy workflow, and it is the cost the whole decision buys.
- We cannot offer "drop in your passport and we'll fill everything", which is the
  demo competitors will show.
- A value and its supporting document can drift apart — a renewed passport means
  a new number *and* a new scan, and nothing links them automatically. Freshness
  (ADR 006) is what catches this, by asking rather than by reading.

## When to revisit

If users abandon onboarding at the typing step in numbers that matter — and then
the answer is the consented, on-device, per-document version, with its own ADR
naming the files it touches. Not a quiet capability added behind an existing
tool.
