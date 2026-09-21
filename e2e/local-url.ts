/**
 * Copied fixture pages still point at live analytics, logos and CDNs.
 * Those hosts stall from GitHub's network, so `page.goto` waiting for
 * `load` never finishes and Playwright tears the browser down.
 *
 * E2e never needed those requests — see docs/testing.md.
 */
export const isLocalE2eUrl = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (
    parsed.protocol === "chrome-extension:" ||
    parsed.protocol === "data:" ||
    parsed.protocol === "blob:"
  ) {
    return true;
  }

  return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
};
