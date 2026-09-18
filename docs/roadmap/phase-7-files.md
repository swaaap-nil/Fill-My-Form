# Phase 7 — File references and compliance

**Depends on:** 6. **Unblocks:** 8.

> **Implemented.** This phase now has a first browser-backed implementation. File bytes stay
> behind replaceable adapters; core sees only serialisable references and metadata.

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

**Millimetres, kilobytes and DPI are all one problem.** The goal line above says 35×45 mm, and
making that literally true took three things that did not exist at first:

- *Units.* `src/core/files/units.ts` converts px/in/cm/mm, always at an explicit DPI. There is no
  such thing as "35 mm in pixels" without a resolution.
- *DPI.* `canvas.toBlob` writes no density header, so a correctly sized photo still failed a
  portal that checks resolution. `src/core/files/dpi.ts` reads and writes JFIF, EXIF and PNG
  `pHYs` — container metadata, never content. WebP is read-only; it has no density field. See
  [ADR 008](../adr/008-image-metadata-writing.md).
- *Two compliance levers, not one.* The quality ladder alone cannot shrink a PNG, whose encoder
  is lossless, so a PNG over `maxFileSizeBytes` used to fail outright. The adapter now falls back
  to downscaling in 0.85 steps down to a 64px floor. Sizing is therefore a negotiation between
  dimensions and bytes, and the result reports which lever moved.

**Prepared output explains itself.** `PreparedArtifact.validation` carries what actually happened
— the crop applied, the encoder quality chosen, how many downscale steps were needed, the DPI
written — rather than a fixed list of reassurances. A failure names the lever that ran out, so
"try JPEG instead of PNG" is advice the user can act on.

**All file work goes through generic adapters.** The first adapter set is browser-native and
IndexedDB-backed, but the interfaces are deliberately generic:

- `FileReferenceStore` persists user-tagged files as local Blobs and returns opaque
  `file_ref` metadata.
- `FileComplianceAdapter` checks `accept` / `maxFileSizeBytes` and prepares a compliant upload
  copy. Images may be recompressed; non-image files must already satisfy size constraints.
- `FileUploadAdapter` owns the browser mechanics for applying a prepared file to
  `input[type=file]`.

Future open-source compression or storage implementations replace these adapters, not the
agent loop or matcher.

**Upload transfer is one-use and metadata-addressed.** The background stages prepared bytes in
`chrome.storage.session` under a generated upload id, then sends the content script only
`decisionId`, `fieldId` and `uploadId`. The content script consumes and removes that staged
payload before setting `input.files`. Agent state, proposals, run views and normal messages do
not carry raw bytes.

**Tagged files are stored as memory references.** A file concept stores a serialisable
`FileReference` value:

```ts
{
  kind: "file_ref",
  id: string,
  name: string,
  mimeType: string,
  sizeBytes: number,
  createdAt: string,
}
```

The Blob itself lives in the file adapter's IndexedDB database. Local-data import/export
continues to carry memory metadata only; it does not export the user’s file bytes.

**Declared max-file-size constraints can be fixture-provided.** The extractor now reads
`data-max-file-size-bytes` on file inputs into the existing `maxFileSizeBytes` constraint. This
keeps test forms explicit without adding non-standard content reading.

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
| Adapter orchestration | **Yes, unit.** Fake compliance/upload adapters prove core coordinates file references without Blob or DOM access. | The generic adapter boundary is what lets us replace browser-native pieces later. |
| Compliance transforms | **Yes, e2e.** An oversized image is transformed to meet a stated `maxFileSizeBytes` and `accept`, and the original is unmodified. | Silent corruption of a user's only copy of a document is unrecoverable. |
| "Never reads content" | **Yes** — assert no code path passes file bytes to prompts, logs or network calls. Bytes are permitted only inside file adapters and the one-use upload staging path. | The phase's central risk, made mechanical. |

## Gate

- A resume uploads on `simple.html` (which declares `accept=".pdf,application/pdf"`, max 2 MB).
- An oversized photograph is transformed to a compliant copy; the original is untouched.
- The forbidden-dependency check fails when a vision or OCR package is added.
- No file bytes reach a prompt, a log or a network call.
- `bun check` includes the forbidden-dependency guard.
- `bun test:e2e` covers resume upload, image recompression and the local-data import selector
  after onboarding gained real file inputs.

## Escalate if

- A form requires a value that only exists inside a document and the user has not typed it.
  The answer is to ask them to type it once. If that proves genuinely unworkable at scale, ADR
  005 names the revisit path: a consented, on-device, per-document version with its own ADR —
  not a capability quietly added behind an existing tool.
