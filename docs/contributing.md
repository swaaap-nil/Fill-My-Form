# Contributing

Agents should read the repo-level [AGENTS.md](../AGENTS.md) before changing
code. Its hard design rules apply to every contribution.

## Before you push

```bash
bun check   # lint + typecheck + test
```

A pre-commit hook runs the fast subset (lint-fix, typecheck). Tests and the build
run in CI. If the hook ever gets slow enough that people start using
`--no-verify`, move the slow part to CI.

## Dev-mode gotchas

Two things about `bun dev` that cost real time when they bite:

**The dev server serves every script over HTTP.** Extension pages fetch them
from a `chrome-extension://` origin, and Vite 8 blocks cross-origin requests by
default. Without `server.cors` in `wxt.config.ts` the side panel loads no
JavaScript and renders as a blank white panel — the only clue is a CORS error
in the panel's own console, which you have to open the panel to see. If a
surface goes blank in dev but works in `bun run build`, suspect this first.

**The dev profile is shared and locked.** `.chrome-profile/` persists so you
only pin the extension once, but Chrome allows one instance per profile. A
second `bun dev`, or a dev browser left running, would otherwise fail with
`CDP connection closed before response to Extensions.loadUnpacked`, which names
nothing useful. `scripts/dev-preflight.ts` catches that: it clears a lock whose
owner is gone, and explains the one that is still alive. `bun dev:fresh` uses a
throwaway profile.

**Dev mode rewrites the CSP.** WXT replaces `content_security_policy` with its
own in dev, so a CSP problem can be invisible until you build for production.
The e2e suite runs against the production build for that reason.

## Commits

Conventional Commits, enforced by commitlint on `commit-msg`:

```
feat(ontology): add nationality concept
fix(tools): reject unknown tool names before schema validation
docs(privacy): explain the manifest hook
```

## Where code goes

| It is... | It goes in |
|---|---|
| A rule, type or pure function about the domain | `src/core/<module>/` |
| Anything touching the DOM, storage or the network | `src/lib/` or an entrypoint |
| React | `src/components/` or `src/app/` |

If you are unsure, try to put it in `src/core`. If lint stops you, that is the
answer.

## The boundaries are not negotiable by exception

If `noRestrictedImports` blocks you, the fix is almost never to add an
exemption. It is to invert the dependency: declare an interface in `src/core`
and implement it outside. The one existing exemption — `llm/ai-sdk.ts` — is
documented in an ADR.

## Adding things

- **A tool** → [`src/core/tools/README.md`](../src/core/tools/README.md)
- **An LLM provider** → [`src/core/llm/README.md`](../src/core/llm/README.md)
- **An ontology concept** → [`src/core/ontology/README.md`](../src/core/ontology/README.md)

## ADRs

Write one when a decision constrains future work, has a real alternative, or you
would otherwise have to re-explain it. Not for decisions with an obvious answer,
and not for modules that do not exist yet — a record of a thing not yet built is
a spec wearing the wrong hat.

Copy the shape of `docs/adr/001-single-package-over-monorepo.md`: context,
decision, alternatives, consequences. Consequences should include the ones you
do not like.

## Style

Biome decides formatting; do not argue with it. Beyond that:

- Prefer pure functions and explicit state.
- Prefer a slightly longer explicit type to a clever generic.
- Comment the *why*, not the *what*. A comment explaining that a regex keeps
  Devanagari combining marks earns its place; one saying "loop over concepts"
  does not.
- No `utils.ts` dumping grounds. If it does not have a home, it probably belongs
  to a module that does not exist yet.
