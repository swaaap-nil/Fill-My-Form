# `verification/` — did it actually work?

A tool returning without throwing proves only that our code ran. It does not
prove the page accepted the input: a React-controlled input can reject a
programmatic value, a select can silently keep its old option, a masked field
can reformat what was typed.

So after ACT the runtime reads the DOM back and compares intent against reality.

```
tool executes -> read actual state -> compare expected vs actual -> result
```

A failed verification returns the run to `PLAN`, not to `ACT`: the retry is
re-decided rather than repeated.

## One privacy note

`VerificationIssue.expected` and `.actual` may contain personal data. They exist
for the review UI and the agent's next decision. Log `code` and `fieldId` only —
`LogFields` in `~/core/logging` will not let you log the others by accident.

## The `Verifier` implementation (Phase 2)

`~/lib/form/verify.ts`'s `compareFieldValue` is the DOM-reading half — pure
enough to unit-test its one hard rule (never reads a `password` field, a
duck-typed check so it needs no real DOM) without a browser, everything else
covered by `e2e/verify.spec.ts` against `controlled.html`. It never uses
`failed()` for `VALUE_NORMALISED`: a masked field reformatting what was typed
is treated as a pass whose issue is still recorded, not a failure to retry.

`~/app/background`'s `buildLoopPorts` supplies the other half — a `Verifier`
that sends the `verifyField` message the content script answers — so the
loop never touches the DOM itself, only through this port.
