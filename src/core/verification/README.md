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

## What lands here next

The DOM-reading `Verifier` implementation, which is an adapter and lives outside
`src/core`.
