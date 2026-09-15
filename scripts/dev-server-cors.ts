/**
 * In dev, WXT serves every script from the Vite dev server and the extension
 * pages fetch them from a `chrome-extension://` (Chrome) or `moz-extension://`
 * (Firefox) origin. Vite 8 blocks cross-origin requests by default, so
 * without allowing these origins the side panel loads no JavaScript and
 * renders as a blank white panel with only a CORS error in its console.
 *
 * Scoped to extension origins rather than `true`: the dev server also serves
 * source files, and a page you visit while developing should not be able to
 * read them. Anchored with `^` so a spoofed host (e.g.
 * `https://chrome-extension.evil.com`) can't slip through.
 */
export const EXTENSION_ORIGIN_PATTERN = /^(chrome|moz)-extension:\/\//;
