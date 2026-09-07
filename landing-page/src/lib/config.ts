export function validateConfig(env: Record<string, string | undefined>) {
  const production = env.SITE_ENV === 'production';
  const site = env.PUBLIC_SITE_URL || 'https://preview.fillmyform.invalid';
  const url = new URL(site);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'PUBLIC_SITE_URL must be an HTTPS origin without a path, credentials, or query.',
    );
  }
  const chrome = env.PUBLIC_CHROME_STORE_URL || '';
  for (const [value, host, prefix] of [
    [chrome, 'chromewebstore.google.com', '/detail/'],
  ] as const) {
    if (!value) continue;
    const target = new URL(value);
    if (
      target.protocol !== 'https:' ||
      target.hostname !== host ||
      !target.pathname.startsWith(prefix) ||
      target.pathname === prefix ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    ) {
      throw new Error(`Invalid published store URL for ${host}`);
    }
  }
  const ga = env.PUBLIC_GA4_ID || '';
  if (ga && !/^G-[A-Z0-9]+$/.test(ga))
    throw new Error('Invalid GA4 measurement ID');
  if (
    production &&
    (url.hostname.endsWith('.invalid') ||
      !chrome ||
      !ga ||
      env.LAUNCH_REVIEWED !== 'true')
  ) {
    throw new Error(
      'Production requires site URL, Chrome listing, GA4 ID, and LAUNCH_REVIEWED=true after privacy and translation review.',
    );
  }
  return {
    production,
    site: url.origin,
    chrome,
    firefox: env.FIREFOX_VERIFIED === 'true',
    ga: production ? ga : '',
  };
}
export const siteConfig = validateConfig(import.meta.env ?? {});
