import { storeLinks, validateStoreLinks } from './store-links.ts';

export function validateConfig(env: Record<string, string | undefined>) {
  const production = env.SITE_ENV === 'production';
  const { site, chrome, firefox } = validateStoreLinks(storeLinks);
  const ga = env.PUBLIC_GA4_ID || '';
  if (ga && !/^G-[A-Z0-9]+$/.test(ga))
    throw new Error('Invalid GA4 measurement ID');
  return {
    production,
    site,
    chrome,
    firefox,
    ga: production ? ga : '',
  };
}
export const siteConfig = validateConfig(import.meta.env ?? {});
