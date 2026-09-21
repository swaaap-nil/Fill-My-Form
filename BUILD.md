# Reproducible build instructions

For Mozilla's Add-on reviewers (and anyone else) to rebuild the exact `.xpi`
submitted to addons.mozilla.org from the source code in this repository.

## Environment this build was produced on

- **OS:** macOS 15.1 (also builds cleanly on Ubuntu 22.04+ and Windows 11;
  nothing in the build touches OS-specific paths or native modules)
- **Bun:** 1.3.14 (pinned in `.bun-version`, which CI also reads)
- **Node.js:** 24.18.0 (required: `>=24`, see `package.json`'s `engines` field)
- **Package manager:** Bun's own (`bun install`), using the committed
  `bun.lock` — no `npm`, no `yarn`, no `pnpm`

No native compilation step, no network access during build beyond installing
dependencies, and no environment variables are required — every third-party
integration (Supabase, analytics) is optional and the extension builds and
runs fully functional with none configured. See `docs/privacy.md` and
`.env.example`.

## Steps

```bash
# 1. Install Bun (skip if already installed)
curl -fsSL https://bun.sh/install | bash

# 2. Clone the exact commit the submission was built from
git clone <repository-url>
cd fill-my-form
git checkout <commit-sha>

# 3. Install dependencies exactly as locked
bun install --frozen-lockfile

# 4. Build the Firefox target
bun run build:firefox
```

## Output

```
build/firefox-mv2/               # unpacked extension
build/fill-my-form-0.1.0-firefox.zip   # the submitted package
build/fill-my-form-0.1.0-sources.zip   # this repository, zipped, for AMO's source review
```

`build/fill-my-form-0.1.0-firefox.zip`'s contents should be byte-identical to
the package uploaded to addons.mozilla.org for version `0.1.0` (modulo
filesystem metadata such as file timestamps inside the zip, which Firefox's
own tooling does not treat as significant for review purposes).

## Verifying nothing extra is bundled

```bash
bun run scripts/check-bundle-secrets.ts     # fails if any secret-shaped string is in the build
bun run scripts/check-release-manifest.ts   # fails if host_permissions or any de-starter artifact is present
```

Both are part of this repository's own CI gate (`.github/workflows/ci.yml`)
and run on every commit, not only at submission time.
