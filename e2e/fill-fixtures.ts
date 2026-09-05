import { resolve } from "node:path";
import { createExtensionFixtures } from "./fixtures";

/**
 * `e2e/fill.spec.ts` only. Loads `build-e2e/chrome-mv3` — the
 * `WXT_E2E=1` build that carries `http://localhost:4173/*` in
 * `host_permissions`, because Playwright cannot click Chrome's native
 * permission bubble. `bun run build:chrome:e2e` produces it; `bun
 * test:e2e` runs that alongside the ordinary build.
 */
const EXTENSION_PATH = resolve(process.cwd(), "build-e2e/chrome-mv3");

export const test = createExtensionFixtures(EXTENSION_PATH);
export const expect = test.expect;
