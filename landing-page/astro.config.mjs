import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwind from '@tailwindcss/vite';
import { loadEnv } from 'vite';
const env = loadEnv(process.env.NODE_ENV || 'production', process.cwd(), '');
export default defineConfig({
  site:
    process.env.PUBLIC_SITE_URL ||
    env.PUBLIC_SITE_URL ||
    'https://preview.fillmyform.invalid',
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false,
  integrations: [sitemap({ filter: (page) => !page.endsWith('/404/') })],
  vite: {
    plugins: [tailwind()],
  },
  trailingSlash: 'always',
});
