import { appendFileSync } from 'node:fs';
// Astro's generated hashed-asset cache header remains intact.
appendFileSync(
  'dist/client/_headers',
  '\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n' +
    (process.env.SITE_ENV === 'production'
      ? ''
      : '  X-Robots-Tag: noindex, nofollow\n'),
);
