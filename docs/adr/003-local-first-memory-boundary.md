# 003 — Personal memory is local-only, enforced by lint

**Status:** accepted · 2026-08-30

## Context

The product's central claim is that personal information stays on the user's
device. The brief states it as a principle:

> The architecture should make accidental mixing difficult.

A principle in a document does not make anything difficult. The pressure to blur
this boundary will be ordinary and reasonable: syncing memory across devices,
sending context to a hosted model for better accuracy, adding a field to an
analytics event while debugging. Each is a small, defensible step.

The starter also arrives with two cloud clients already wired — Supabase and
OpenPanel — and env validation that *required* their keys, so a fresh clone could
not run without a cloud account.

## Decision

Make the boundary a build failure.

**Lint rules.** `src/core/**` may not import React, `#imports`, Supabase,
OpenPanel or a model SDK. `src/core/memory/**` additionally may not import
anything network-capable. Each rule carries its rationale as the failure message.

**A closed log-field allowlist.** `LogFields` has no index signature, so
`logger.info("x", { value })` is a type error. Adding a field is a deliberate,
reviewable act.

**Optional cloud integrations.** Supabase and OpenPanel env vars are optional;
with no keys, `supabase` is `null` and `track()` is a no-op. CI builds with an
empty environment, so "works with no cloud account" stays true.

**No site access at install.** No `host_permissions`; the content script is
registered per origin after the user grants it.

**A secret scanner.** `scripts/check-bundle-secrets.ts` fails CI if a
secret-shaped string reaches the build output.

**No `set_memory` tool.** The model proposes writes; an application service
performs them after policy evaluation and confirmation.

## Alternatives

**Documentation and code review.** Zero cost, and it works until the first
deadline. Review catches the obvious violation and misses the analytics field
added at 6pm.

**A runtime guard** — wrap `fetch` and throw if called from memory code. Catches
what static analysis cannot, but fails in production rather than in CI, and only
on paths that execute.

**Physical separation into a package with no network dependencies.** Genuinely
stronger: you cannot import what is not in your dependency graph. Deferred with
the monorepo decision in ADR 001, and reachable later.

## Consequences

Good:

- Crossing the boundary requires editing `biome.json` in a diff someone reviews,
  rather than adding an import nobody notices.
- The failure message teaches the rule at the moment it is broken.
- The extension is fully functional and fully anonymous with an empty `.env`,
  which is also the easiest possible first-run experience.

Bad:

- The rules are specifier-based. A network client imported under a new name, or
  reached through a re-export, slips past. This is a guardrail, not a sandbox.
- Legitimate future features — encrypted sync, an explicitly consented cloud
  model — will trip these rules. That is the intent: such a feature should arrive
  with an ADR, not with a lint exemption.
- Optional env vars mean a genuine misconfiguration (a typo'd Supabase URL) fails
  later and less obviously than a missing one. Mitigated by validating the shape
  of each value when it is present.

## When to revisit

When a feature genuinely requires personal data to leave the device. The answer
is not to relax these rules but to write the ADR that justifies the exception,
name the data, and put it behind explicit consent.
