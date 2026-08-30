# Contributing

See [docs/contributing.md](./docs/contributing.md).

Quick version:

```bash
bun install
cp .env.example .env
bun check      # lint + typecheck + test
```

Conventional Commits are enforced. The domain layer in `src/core` may not import
React, browser APIs, cloud clients or model SDKs — if lint blocks you, invert the
dependency rather than adding an exemption.
