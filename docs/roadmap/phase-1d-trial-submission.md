# Phase 1d — A throwaway submission, to buy information

**Depends on:** 1c. **Unblocks:** 6. **Runs in parallel with Phase 2** — most of it is waiting.

## Goal

Submit an **unlisted** build to both stores. You are not shipping. You are discovering review
friction, publisher-verification latency and the AMO source-build requirement at a moment when
a rejection costs nothing but a day.

The alternative is discovering all of it on launch day, when a two-week publisher verification
or a single-purpose rejection is a schedule event rather than a lesson.

## Required reading

- [`_context.md`](./_context.md) first.
- `.github/workflows/publish.yml` — untouched Extro baseline, never exercised.
- Phase 0's handback — the privacy policy URL and account status.
- `docs/privacy.md` — the permission rationale you will paraphrase for reviewers.

## Inline context

The extension requests `storage`, `sidePanel`, `activeTab`, `scripting`, and
`optional_host_permissions` for all `http`/`https`. That last one draws the most scrutiny, and
the honest answer is unusually strong: **the extension ships with no host permissions at all.**
`chrome://extensions` shows no site access after install. Access is requested per-origin at
runtime, from a user gesture, and is revocable. Forms exist on arbitrary origins, which is why
the *optional* pattern is broad, but nothing is granted until the user grants it.

## Deliverables

### 1. Exercise the pipeline before using it

Run `wxt submit --dry-run` against both targets. `publish.yml` has never run: it is
`workflow_dispatch`-only, has no version-bump step, no dry-run gate, and shell globs in the
`run:` block that break if more than one zip matches. Find that out now.

Do **not** rewrite the pipeline in this phase — Phase 6 owns that. Record what broke.

**Tests:** none. **Why:** it is a pipeline invocation. The output is the artefact.

### 2. Listing copy and assets

- Draft the store description. Avoid keyword stuffing and unbacked "AI" claims — both are
  active rejection categories.
- The single-purpose statement. Phase 0 removed the new-tab override, the devtools panel and
  the chat demo, so this should now be straightforward: the extension fills forms.
- Per-permission justification text, one paragraph each, using the framing above.
- Screenshots at 1280×800. **Show the per-origin grant prompt and the confirmation review** —
  those are what differentiate this product, and a reviewer who sees consent in the screenshots
  reads the rest more generously.
- Data-handling disclosure: "does not collect or transmit user data". Verify this is literally
  true before submitting — `analytics.ts` is gone and `supabase.ts` is unreachable by lint rule,
  so it should be.

**Tests:** none. **Why:** it is prose and images.

### 3. Submit unlisted to both stores

Chrome Web Store and AMO, unlisted, as `0.1.0`.

AMO additionally requires **reproducible build instructions** in the sources zip: exact Bun
version, Node version, OS, and the commands. Add `BUILD.md` for this. Expect manual human review
given the breadth of the optional host permissions.

**Tests:** none.

### 4. Write down what came back

The whole point. Record in the handback:

- How long publisher verification took, and whether it is still pending.
- Every reviewer question, verbatim.
- Any rejection, its stated reason, and what would fix it.
- Whether the AMO source build succeeded from `BUILD.md` alone.
- What the pipeline could not do that Phase 6 must fix.

## Gate

Both submissions lodged, and either approved or rejected **with a reason you now understand**.
A pending review is not a failure of this phase — an unrecorded one is.

## Out of scope

Do not fix the release pipeline; Phase 6 does, informed by what you find. Do not make the
listing public. Do not add features to satisfy a reviewer without escalating first — a
reviewer's suggestion is not automatically compatible with the ADRs.

## Traps

- **Submitting listed by accident.** Unlisted. Check twice.
- **Burning the version number.** Chrome requires monotonically increasing versions and you
  cannot reuse one. Treat `0.1.0` as spent.
- **Fixing a rejection by widening permissions.** If a reviewer objects to the optional host
  pattern, that is an escalation. The answer is better justification text, not `activeTab`-only
  scope that breaks the product.
