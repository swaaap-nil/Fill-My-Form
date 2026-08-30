# Contributing

## Before you push

```bash
bun check   # lint + typecheck + test
```

A pre-commit hook runs the fast subset (lint-fix, typecheck). Tests and the build
run in CI. If the hook ever gets slow enough that people start using
`--no-verify`, move the slow part to CI.

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
