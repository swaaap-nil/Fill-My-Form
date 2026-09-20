/** Public site and store listing URLs — edit here, not via env. */
export const storeLinks = {
  site: 'https://getfillmyform.store',
  /** Empty hides the Chrome install button until a listing URL is set. */
  chrome: '',
  firefox: 'https://addons.mozilla.org/en-US/firefox/addon/fill-my-form/',
} as const;

export function validateStoreLinks(links: {
  site: string;
  chrome: string;
  firefox: string;
}) {
  const url = new URL(links.site);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'Site URL must be an HTTPS origin without a path, credentials, or query.',
    );
  }
  const chrome = links.chrome;
  const firefox = links.firefox;
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
  if (firefox) {
    const target = new URL(firefox);
    const addon = '/firefox/addon/';
    if (
      target.protocol !== 'https:' ||
      target.hostname !== 'addons.mozilla.org' ||
      !target.pathname.includes(addon) ||
      target.pathname.endsWith(addon) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    ) {
      throw new Error('Invalid published store URL for addons.mozilla.org');
    }
  }
  return {
    site: url.origin,
    chrome,
    firefox,
  };
}
