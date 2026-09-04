# Phase 6 — Release v1

**Depends on:** 1d, 3, 4, 5. **Unblocks:** 7.

> **Outline, not a finished brief.** Expand using 1d's handback — the reviewer questions and
> pipeline failures it recorded are the actual requirements for this phase.

## Goal

Ship a local-only, free v1 to the Chrome Web Store and AMO, through a pipeline that runs from a
tag rather than from someone's laptop.

## Required reading

- [`_context.md`](./_context.md) first.
- **1d's handback** — reviewer questions, rejection reasons, what the pipeline could not do.
- `.github/workflows/publish.yml` and `tests.yml`.
- `commitlint.config.ts` — conventional commits are already enforced, which is what makes
  automated versioning viable.

## Shape of the work

**Rewrite `publish.yml` as `release.yml`, triggered on tag push `v*`:**

1. **verify** — assert the tag matches `package.json`'s version; call `tests.yml` via
   `workflow_call`.
2. **build** — Chrome, Firefox and sources zips; run `check-bundle-secrets.ts` and
   `check-release-manifest.ts` against both targets; upload artifacts.
3. **submit** — `wxt submit --dry-run` as a **required gate**, then the real submit, in
   `environment: Production` with required reviewers.

The current file is untouched Extro baseline: `workflow_dispatch`-only, no version bump, no
dry-run, and shell globs that break when more than one zip matches. 1d found out how it fails;
fix what it found.

**Add automated versioning.** `commitlint` already enforces conventional commits, so
release-please is the natural fit — it produces the version bump, `CHANGELOG.md`, the tag and
the GitHub release from commit history, and guarantees monotonically increasing versions.
Chrome requires that, and a burned version number is unrecoverable. `git-cliff` is the
alternative if manual tagging is preferred.

**Store listing.** Refine 1d's drafts using whatever the reviewers actually asked. Screenshots
should lead with the per-origin grant and the confirmation review.

## Testing decisions

| Deliverable | Tests | Why |
|---|---|---|
| `check-release-manifest.ts` on both targets | **Yes** — extend Phase 0's unit tests to cover the Firefox manifest shape. | Chrome-only checking is why the Firefox build drifted. |
| The release workflow | **Yes, by rehearsal** — cut a `v0.0.0-rc` tag against the unlisted listings and let the whole pipeline run. | A release pipeline first exercised on a real release is not a pipeline, it is a hope. 1d proved the submit step; this proves the whole chain. |
| Version monotonicity | **Yes** — a CI assertion that the tag is greater than the currently published version. | The failure is unrecoverable, and it is one typo away. |
| Store listing copy | **No tests.** | It is prose. |

## Gate

- A tagged release builds, passes every guard, dry-runs clean, and submits to both stores.
- `CHANGELOG.md` is generated, not hand-written.
- The data-handling disclosure — "does not collect or transmit user data" — is verifiably true:
  `analytics.ts` gone, `supabase.ts` unreachable by lint rule, no network call in a fill.
- The privacy policy URL is live and describes what the product actually does.
- Both listings public and approved.

## Out of scope

No monetization, no accounts, no cloud. v1 is local-only and free — that was decided, and it is
also what makes the store disclosures clean.

## Escalate if

- A reviewer requires a change that conflicts with an ADR. Widening permissions or adding
  telemetry to satisfy a reviewer is a product decision, and there is usually a
  documentation-shaped answer instead.
