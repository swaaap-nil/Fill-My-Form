import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4322',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && wrangler dev --ip 127.0.0.1 --port 4322',
    url: 'http://127.0.0.1:4322/en/',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      ASTRO_TELEMETRY_DISABLED: '1',
      ASTRO_DEV_BACKGROUND: '1',
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: '/tmp/fmf-test-wrangler.log',
      SITE_ENV: 'production',
      PUBLIC_SITE_URL: 'https://example.com',
      PUBLIC_CHROME_STORE_URL:
        'https://chromewebstore.google.com/detail/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      PUBLIC_GA4_ID: 'G-TEST123',
      LAUNCH_REVIEWED: 'true',
    },
  },
});
