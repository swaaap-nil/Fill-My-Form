# Fill My Form Launch Research

Research date: 2026-09-07

This file records the launch research used for the landing page copy. It is a planning artifact, not a runtime dependency.

## Keyword Research

Tool: Ahrefs Free Keyword Generator, Google mode, checked from the live web UI on 2026-09-07.

Source: https://ahrefs.com/keyword-generator

Ahrefs states that the free generator returns keyword ideas with SEO metrics and location targeting. The results below were used only to tune wording. Broad form-filling searches mixed browser-extension intent with PDF tools, mobile how-to queries, job-application portals, government forms, and automation scripts, so the landing page copy stays specific to personal desktop browser forms and does not imply universal website support.

| Locale | Market Checked | Seed | Observed Result Pattern | Copy Decision |
| --- | --- | --- | --- | --- |
| English | United States | `form filler extension` | Relevant variants included Chrome form filler extension, AI form filler extension, and auto form filler extension. Visible demand was low-volume but clearly extension-oriented. | Use factual Chrome extension language and avoid completion/performance claims. |
| Hindi | India | `फॉर्म भरना` | Results were dominated by mobile form-filling and specific government/job application searches. | Mention repeated online forms, desktop Chrome, and review before submit; avoid mobile-first claims. |
| Spanish | Spain | `rellenar formularios` | Results mixed generic form filling, Chrome extension language, and PDF/document intent. | Use browser-form language and avoid PDF positioning. |
| Portuguese | Brazil | `preencher formulários` | Results mixed online form filling, PDF/admin tasks, and paid form-work intent. | Keep the value prop about personal repeated details; avoid earnings or service-work language. |
| French | France | `remplissage automatique formulaire` | Results included Chrome/Google Chrome variants plus platform-specific autofill and scripts. | Use `formulaire` and browser context; avoid saying every site is supported. |
| German | Germany | `formulare automatisch ausfüllen` | Results included Chrome, browser, Firefox, PHP/script, and mobile variants. | Use automated form-fill phrasing with clear user review language. |
| Indonesian | Indonesia | `mengisi formulir otomatis` | The free tool returned no keyword ideas for this exact seed in the checked market. | Use natural product copy rather than forcing unsupported keyword phrasing. |
| Arabic | Saudi Arabia | `تعبئة النماذج` | Results leaned toward job-form and training/document contexts, with some software phrasing. | Use general form-reuse language and keep compatibility limits clear. |
| Japanese | Japan | `フォーム 自動入力` | Results included Chrome autofill, extension, Google Forms, scripts, and mobile variants. | Use Chrome extension wording and keep manual review prominent. |
| Simplified Chinese | Singapore | `自动填表` | Mainland China was not available in the Ahrefs market dropdown used during the check. Visible results included `自动填表` and Chrome-specific phrasing. | Use browser/Chrome language and record that this was Singapore-market research, not mainland-market validation. |

## Domain Shortlist

Tool: Instant Domain Search, used as the designated domain research source.

Source: https://instantdomainsearch.com/

Instant Domain Search describes live domain availability checks across 800+ extensions, bulk search, WHOIS lookup, and domain research tools. Availability changes quickly and final selection/purchase remains an owner decision, so this implementation does not make availability claims.

Shortlist to check live before purchase:

| Candidate | Rationale |
| --- | --- |
| `fillmyform.com` | Exact brand, easiest to remember. |
| `fillmyform.app` | Product category fit if exact `.com` is unavailable or premium. |
| `fillmyform.io` | Common SaaS alternative. |
| `fillmyform.co` | Short commercial alternative. |
| `getfillmyform.com` | Action-oriented fallback that keeps the exact brand. |
| `tryfillmyform.com` | Launch-campaign fallback. |
| `fillmyformextension.com` | Descriptive fallback for search intent. |
| `fillmyforms.com` | Plural variant to protect against mistypes if available. |

Owner checklist before choosing a domain:

- Re-check the candidates in Instant Domain Search on the purchase date.
- Check trademark risk separately.
- Prefer the exact brand if affordable.
- Configure the chosen domain in `src/lib/store-links.ts` and Cloudflare custom-domain DNS.

## Sources Rechecked

- Ahrefs Keyword Generator: https://ahrefs.com/keyword-generator
- Instant Domain Search: https://instantdomainsearch.com/
- Astro internationalization guide: https://docs.astro.build/en/guides/internationalization/
- Astro Cloudflare deployment guide: https://docs.astro.build/en/guides/deploy/cloudflare/
- Google consent mode guide: https://developers.google.com/tag-platform/security/guides/consent
