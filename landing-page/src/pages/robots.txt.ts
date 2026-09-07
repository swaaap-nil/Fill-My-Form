import { siteConfig } from '../lib/config';
export const prerender = true;
export function GET() {
  return new Response(
    siteConfig.production
      ? `User-agent: *\nAllow: /\nSitemap: ${siteConfig.site}/sitemap-index.xml\n`
      : 'User-agent: *\nDisallow: /\n',
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
