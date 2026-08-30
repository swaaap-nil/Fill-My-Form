# 001 — Single package over a monorepo

**Status:** accepted · 2026-08-30

## Context

The product brief proposed a monorepo:

```
apps/extension  apps/web
packages/shared-types  packages/ontology  packages/agent-core  packages/llm  packages/validation
```

The chosen foundation, [Extro](https://github.com/turbostarter/extro), is a
single package: WXT with `srcDir: "src"`, `entrypointsDir: "app"`, one
`package.json`, one `tsconfig.json`, one Biome config.

The goal the monorepo was serving is real — the domain must not become entangled
with React, the browser, or a model vendor. The question is what enforces that.

## Decision

Stay a single package. Put the domain in `src/core/<module>/` and enforce the
boundaries with Biome `noRestrictedImports` overrides.

`src/core/**` may not import React, `#imports`, `@supabase/supabase-js`,
`@openpanel/web`, `ai` or `chrome-ai`. `src/core/memory/**` additionally may not
import anything network-capable. Each rule carries a message explaining itself at
the point of failure. Violations fail `bun lint`, which CI runs.

## Alternatives

**Bun workspaces now.** Enforces boundaries through `package.json` dependencies —
the strongest available mechanism. Costs WXT reconfiguration, tsconfig project
references, slower installs, and a build graph to maintain. All of that for a
second consumer that does not exist: there is no `apps/web`, and the brief
defers everything that would need one.

**Convention only.** A `docs/` page saying which directory may import what.
Costs nothing and enforces nothing. Boundaries maintained by discipline erode at
the first deadline.

**Single package, monorepo-shaped directory names.** Cosmetic. The names do not
make the later split easier; the import graph does.

## Consequences

Good:

- Boundary violations fail with a message that explains the rule, in the file
  that broke it. That is better feedback than a resolution error.
- The domain layer stays runnable under plain `bun test` — no DOM, no extension
  host, no network — which is why the suite is sub-second.
- One install, one lockfile, one lint config, one type check.

Bad:

- Enforcement is one config file away from being switched off. A workspace
  boundary cannot be disabled by editing a rule. Mitigated by keeping each rule's
  rationale in its message and documenting the mechanism in `docs/privacy.md`.
- Biome's `noRestrictedImports` matches module specifiers, not directories, so
  `src/core` cannot be stopped from importing `src/app` by this mechanism. In
  practice the dependency never points that way, and the type graph makes it
  obvious when it does.
- Extracting to workspaces later means moving files and adding manifests. The
  import graph will already be correct, so this is mechanical.

## When to revisit

When `apps/web` actually exists, or when a second consumer needs `src/core`
without the extension. Both are real triggers; neither has happened.
