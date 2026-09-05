/**
 * The injectable form of the extractor.
 *
 * Bundled to a standalone browser IIFE (`bun run build:extractor`, see
 * `package.json`) and loaded via `page.addScriptTag()` in `e2e/extraction.spec.ts`.
 * No extension, no manifest, no permissions — this keeps golden-testing the
 * extractor independent of site-access wiring, which is not built until
 * Phase 1c.
 *
 * `bun build --format=iife` discards unreferenced exports rather than
 * exposing a global, so this file's only job is the side effect of
 * attaching the two entry points to `globalThis`.
 */
import { extract, extractFull } from "./extract";

declare global {
  interface Window {
    __formAgentExtract?: typeof extract;
    __formAgentExtractFull?: typeof extractFull;
  }
}

window.__formAgentExtract = extract;
window.__formAgentExtractFull = extractFull;
