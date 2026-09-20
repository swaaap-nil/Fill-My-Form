# Fill My Form Landing Page

Independent Astro site for the global Fill My Form launch. The site is built from `landing-page`, uses Tailwind CSS v4 through `@tailwindcss/vite`, deploys to Cloudflare Workers through Astro's Cloudflare adapter, and defaults visitors to their saved or browser language.

## What Is Included

- Localized routes for `/en/`, `/hi/`, `/es/`, `/pt-br/`, `/fr/`, `/de/`, `/id/`, `/ar/`, `/ja/`, and `/zh-cn/`.
- Dynamic `/` language selection using the saved `fmf-language` cookie first, then `navigator.languages`, then `Accept-Language`, then English.
- Stable explicit locale URLs and language switching with an `Automatic` option that restores browser detection.
- Localized home, help, privacy, metadata, social tags, canonical URLs, reciprocal `hreflang`, `x-default`, sitemap, robots, JSON-LD, consent copy, and accessibility labels.
- Privacy-first GA4 wiring: analytics is off until consent, page views and install-link clicks are tracked only after opt-in, and URL query strings are stripped.
- Cloudflare Worker configuration with preview and production worker names.
- CI from the `landing-page` directory for checks, build, and Playwright verification, plus a manual deploy job.

## Setup

Install dependencies from this directory:

```sh
npm install
```

The requested design and agent references are stored separately:

- Relayed primary reference: `design-references/relayed/DESIGN.md`
- Vercel secondary reference: `design-references/vercel/DESIGN.md`
- Project design direction: `DESIGN.md`

The requested project skills are installed at the repository root under `.agents/skills/`:

- `web-design-guidelines`
- `tailwind-4-docs`

The Astro Docs MCP server is configured in the root `.codex/config.toml` as `https://mcp.docs.astro.build/mcp`.

## Environment

Copy `.env.example` when preparing a real preview or production environment.

Site and store listing URLs live in `src/lib/store-links.ts` (not env). Set
`chrome` or `firefox` to an empty string to hide that install button.

Production builds set `SITE_ENV=production` (via `npm run build:production` or
Cloudflare build command). `PUBLIC_GA4_ID` is optional until analytics is ready;
leave it unset and the site ships without GA4.

## Commands

`npm run dev` builds the site and starts Wrangler locally, matching the Cloudflare Worker runtime used in deployment.

```sh
npm run dev
npm run check
npm test
npm run build
npm run test:e2e
npm run preview
npm run deploy:preview
npm run deploy:production
```

`npm run deploy:production` builds with production validation, then calls Wrangler deploy with the Cloudflare production environment. Production validation fails until the final domain, Chrome listing, GA4 ID, and review flag are present.

## Cloudflare Notes

Astro's Cloudflare guide recommends the Cloudflare adapter for on-demand rendering and the Wrangler flow of `astro build` followed by `wrangler dev` or `wrangler deploy`. This project uses server output so `/` and `/404` can handle language fallback dynamically, while localized content pages are prerendered.

Preview builds keep analytics disabled and emit `noindex` headers/meta. Production analytics only loads after consent.

Before production launch, configure:

- Cloudflare account and Worker access.
- Production custom domain with HTTPS.
- GitHub environment secrets used by `.github/workflows/landing-page.yml`.
- Rollback process: keep the previous successful GitHub Actions deployment run and redeploy its commit if a launch rollback is required.

## Launch Blockers

Production launch still needs owner inputs:

- Real Chrome Web Store URL.
- Selected production domain.
- Cloudflare account access and custom-domain DNS.
- GA4 measurement ID and consent policy review.
- Verified privacy disclosures.
- Human translation review for all launch languages.

Website localization does not mean the extension itself supports every language or every website.

## Research

See `docs/launch-research.md` for the dated Ahrefs keyword notes and domain shortlist prepared around Fill My Form.
