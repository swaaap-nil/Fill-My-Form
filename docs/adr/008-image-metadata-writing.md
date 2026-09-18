# 008 — Image metadata is read and written by hand, in-repo

**Status:** accepted · 2026-09-19

## Context

Forms ask for resolution. "Photograph must be 200 DPI", "scan at 300 DPI" is
ordinary language on the same portals that ask for 35 × 45 mm at under 100 KB.
Until now the extension could satisfy the millimetres and the kilobytes and not
the DPI, for a reason that is easy to miss: **DPI is not a property of the
pixels.** The same 413 × 531 bitmap is 300 DPI or 72 DPI depending on a handful
of header bytes, and `canvas.toBlob` — which is what produces every prepared
image here — writes none of them. A correctly sized photo was still being
rejected.

Physical units have the same root. "35 mm" is only a number of pixels *at some
resolution*, so `src/core/files/units.ts` cannot convert anything without a DPI
to convert at. Supporting mm, cm and inches at all requires reading the source
file's declared resolution and letting the user set a target.

That means parsing and emitting container metadata: JFIF and EXIF inside JPEG,
a `pHYs` chunk inside PNG.

## Decision

**The extension reads and writes image density headers, hand-rolled in-repo,
in `src/core/files/dpi.ts`, and only ever on a derived copy.**

Concretely:

- **Read** JFIF APP0 density, EXIF `XResolution`/`YResolution`/`ResolutionUnit`,
  and PNG `pHYs`. EXIF wins over JFIF when both are valid, which matches what
  image tools and portals report.
- **Write** JFIF APP0 (patching in place, or inserting an 18-byte segment after
  SOI when absent) and PNG `pHYs` (patching in place, or inserting a 21-byte
  chunk before the first `IDAT`, with the CRC32 recomputed).
- **Patch existing EXIF rationals only.** Never insert an EXIF tag, never
  rebuild an IFD.
- **WebP is read-only.** It has no native density field; DPI could only ride in
  an optional `EXIF ` chunk, which means rewriting a simple-format file into
  extended VP8X form. The UI disables the DPI field for WebP output and says
  why.
- **No dependency.**

### Why this does not violate ADR 005

[005](./005-no-document-content-reading.md) refuses to read *the inside of a
document* — the passport number on the scan. That refusal is about meaning: OCR,
vision models, anything that interprets what a file depicts.

A density header is not content. It is a number describing how the file should
be printed, sitting in the container alongside the width and height this code
has always read. Nothing here looks at a single pixel, and nothing here learns
anything about the person.

005 already names this boundary and places this work on the allowed side:
"Making a file *fit* a form — crop to 35×45mm, recompress under 100 KB — stays
allowed … It is pixel and byte work that never interprets meaning." Writing a
DPI header is byte work of exactly that kind. `docs/roadmap/phase-7-files.md`
warns that this phase is the one most likely to violate 005 in a
reasonable-sounding way, so it is worth being explicit: the line is
*interpretation*, and reading `pHYs` does not approach it.

### Why hand-rolled rather than a dependency

`scripts/check-forbidden-deps.ts` bans OCR and vision packages only, so a
metadata library would have passed it. This is a judgement call, not a rule:

- The npm options (`piexifjs`, `exif-parser`, `image-size`) are unmaintained,
  string-encoded, or Node-`Buffer`-based, and would need polyfilling under this
  extension's CSP.
- What is actually needed is about 250 lines of `Uint8Array` arithmetic, and it
  stays reviewable by someone who has never seen the library.
- A dependency that can rewrite image bytes is a dependency that can corrupt a
  user's file. The smaller and more testable that surface, the better.

## Alternatives that were real

**Ship no DPI at all.** Cheapest, and it was the status quo. Rejected because it
also kills mm/cm/inch support — there is no conversion without a resolution —
and leaves a common, explicitly stated form requirement unmet.

**Assume 96 DPI everywhere and only convert units.** Half the work for most of
the UI benefit. Rejected because the resulting file still declares nothing, so a
portal checking resolution still rejects it. It would let the UI promise
something the output does not deliver, which is worse than not offering it.

**Full EXIF read/write via a library.** Would also handle orientation and
stripping. Rejected on bundle and CSP grounds above; EXIF orientation is handled
instead by `createImageBitmap(blob, { imageOrientation: "from-image" })`.

## Consequences

- **WebP cannot carry a DPI.** Users who need one must choose JPEG or PNG. The
  UI has to say so rather than silently dropping the value.
- **EXIF tags are patched only when they already exist.** A JPEG with EXIF but
  no resolution tags gets its DPI via JFIF instead. Both are then consistent
  because the write path patches whichever are present.
- **Output can grow.** +18 bytes for an inserted JFIF segment, +21 for a `pHYs`
  chunk. Anything enforcing a byte ceiling must re-check the size *after* the
  DPI is applied, not before.
- **Byte patching can corrupt a file.** This is the real risk. It is contained
  by three rules, all tested: every function returns its input unchanged on any
  parse doubt; every offset is bounds-checked before it is read; the original in
  IndexedDB is never patched, only a derived copy. `src/core/tests/file-dpi.test.ts`
  asserts round trips on synthetic files, CRC validity, and that truncated or
  random bytes never throw at any length.
- **Real decoders are the actual acceptance test.** Synthetic bytes only prove
  self-consistency. Patched files were verified against macOS `sips`, which
  reports 300 DPI and still decodes them at unchanged pixel dimensions.
