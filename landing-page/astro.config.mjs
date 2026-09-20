import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  site: 'https://getfillmyform.store',
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false,
  integrations: [sitemap({ filter: (page) => !page.endsWith('/404/') })],
  vite: {
    plugins: [tailwind()],
  },
  trailingSlash: 'always',
});
