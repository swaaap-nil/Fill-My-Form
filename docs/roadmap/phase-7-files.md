# Phase 7 — File references and compliance

**Depends on:** 6. **Unblocks:** 8.

> **Sketch.** Expand substantially before handing over. Deliberately after v1: this is a large
> surface that raises the store-review bar, and none of it is needed for a form-filling product
> to be useful.

## Goal

Attach the right local file to an upload field, and make it fit the form's requirements —
without ever reading what is inside it.

## Required reading

- [`_context.md`](./_context.md) first.
- `docs/adr/005-no-document-content-reading.md` — the whole thing. This phase is the one most
  likely to violate it, and the violation would be reasonable-sounding.
- `src/core/form/types.ts` — the `accept` and `maxFileSizeBytes` constraints.

## Shape of the work

**Files are references, resolved by the same engine as everything else.** A file-typed concept
(`documents.resume`, `documents.passport`) stores a *reference* to a file the user tagged once.
Resolution uses the same `ConceptIndex` and the same alias tiers as any text concept. The agent
learns which file answers an upload field and never opens it.

**Compliance is pixel and byte work only.** Cropping to 35×45 mm, recompressing under 100 KB —
`OffscreenCanvas` plus `canvas.toBlob(quality)`, in-tab, with the original never modified. This
transforms a file; it never interprets one.

**The line, restated because it will be tested by circumstance:** there is no OCR, no vision
model, no document understanding — not in the cloud, and not on-device either. A value that
appears on a document, like a passport number, is typed by the user once and stored as an
ordinary concept. The claim this protects is "this extension cannot read the inside of your
documents", which a user can verify by looking for the capability and not finding it. "It reads
them, but only locally" is a claim they must take on trust.

## Testing decisions

| Deliverable | Tests | Why |
|---|---|---|
| Forbidden-dependency guard | **Yes** — `scripts/check-forbidden-deps.ts` failing on `tesseract.js`, `pdfjs-dist`, `pdf-parse`, `@google-cloud/vision`, and any `*vision*` / `*ocr*` package. Wire into CI. | A dependency check is a stronger guarantee than a paragraph in an ADR, and it is five lines. |
| File-reference resolution | **Yes, unit.** A file concept resolves through the same matcher tiers as a text concept. | It is the claim that files need no second retrieval path. |
| Compliance transforms | **Yes, e2e.** An oversized image is transformed to meet a stated `maxFileSizeBytes` and `accept`, and the original is unmodified on disk. | Silent corruption of a user's only copy of a document is unrecoverable. |
| "Never reads content" | **Yes** — assert no code path passes file bytes to anything but the canvas transform. Consider a sentinel: a fixture file whose contents are a unique string, asserted never to appear in any prompt, log or message. | The phase's central risk, made mechanical. |

## Gate

- A resume uploads on `simple.html` (which declares `accept=".pdf,application/pdf"`, max 2 MB).
- An oversized photograph is transformed to a compliant copy; the original is untouched.
- The forbidden-dependency check fails when a vision or OCR package is added.
- No file bytes reach a prompt, a log or a network call.

## Escalate if

- A form requires a value that only exists inside a document and the user has not typed it.
  The answer is to ask them to type it once. If that proves genuinely unworkable at scale, ADR
  005 names the revisit path: a consented, on-device, per-document version with its own ADR —
  not a capability quietly added behind an existing tool.
