# `form/` — FormIR

The normalised representation of a web form. Two invariants:

**No DOM.** Nothing here references `HTMLElement` or `Document`. A content
script produces a `FormIR`; the agent only ever sees the `FormIR`. This is what
keeps raw page access away from the model and the domain testable in plain Bun.

**Shape, not content.** A `FormField` says what a field *is* — kind, label,
constraints, options. It does not carry what the user has typed. `hasValue` is
the only signal about current content. Reading a value back is a separate,
authorised act performed by verification, not something riding along in every
observation.

## Progressive disclosure

`FieldSummary` is the cheap projection the agent sees first; `FormField` is the
full picture, fetched per field on request. `PageObservation` carries an origin
and a path, never a full URL with a query string.

## What lands here next

Field-kind inference and constraint extraction — both pure functions over an
already-extracted structure. The extraction itself is an adapter and belongs in
`src/lib` or a content script.
