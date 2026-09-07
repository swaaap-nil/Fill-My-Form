import { defineMiddleware } from 'astro:middleware';
import { siteConfig } from './lib/config';
export const onRequest = defineMiddleware(async (_, next) => {
  const response = await next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!siteConfig.production)
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
});
