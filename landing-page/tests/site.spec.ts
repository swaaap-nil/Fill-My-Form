import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { localeKeys, locales } from '../src/lib/locales';

// Vendor requests are intercepted: tests never send analytics or visit store listings.
test.beforeEach(async ({ page }) => {
  await page.route(
    /https:\/\/(www\.)?(googletagmanager|google-analytics)\.com\//,
    (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  );
});
for (const locale of localeKeys) {
  test(`${locale}: complete pages, mobile/desktop layout and accessibility`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem('fmf-consent', 'rejected'),
    );
    await page.goto(`/${locale}/`);
    await expect(page.locator('html')).toHaveAttribute(
      'lang',
      locales[locale].tag,
    );
    await expect(page.locator('html')).toHaveAttribute(
      'dir',
      locales[locale].dir,
    );
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('link[rel="alternate"]')).toHaveCount(11);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
      await page.screenshot({
        path: `artifacts/${locale}-${width}.png`,
        fullPage: true,
      });
    }
    await page.locator('[data-fill]').click();
    await expect(page.locator('[data-demo]')).toHaveClass(/is-filled/);
    await expect(page.locator('[data-demo-value]').first()).toHaveCSS(
      'opacity',
      '1',
    );
    await page.locator('[data-fill]').click();
    await expect(page.locator('[data-demo]')).not.toHaveClass(/is-filled/);
    for (const path of ['privacy', 'help']) {
      const response = await page.goto(`/${locale}/${path}/`);
      expect(response?.status()).toBe(200);
      await expect(page.locator('h1')).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  });
}
test('browser language, explicit routes, saved choice and Automatic', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'fr-CA' });
  await context.addInitScript(() =>
    localStorage.setItem('fmf-consent', 'rejected'),
  );
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/fr\/$/);
  await page.goto('/en/privacy/');
  await expect(page).toHaveURL(/\/en\/privacy\/$/);
  await page.locator('[data-language]').selectOption('ar');
  await expect(page).toHaveURL(/\/ar\/privacy\/$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/ar\/$/);
  await page.locator('[data-language]').selectOption('auto');
  await expect(page).toHaveURL(/\/fr\/$/);
  expect((await context.cookies()).some((c) => c.name === 'fmf-language')).toBe(
    false,
  );
  await context.close();
});
test('server fallback without JavaScript and private root responses', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: 'de-DE',
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/de\/$/);
  await expect(page.locator('h1')).toBeVisible();
  await context.close();
  const response = await request.get('/', {
    headers: { 'Accept-Language': 'ar' },
  });
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['vary']).toContain('Cookie');
});
test('analytics requires consent, strips URL data, records clicks and stops after withdrawal', async ({
  page,
}) => {
  const vendorRequests: string[] = [];
  page.on('request', (request) => {
    if (/googletagmanager|google-analytics/.test(request.url()))
      vendorRequests.push(request.url());
  });
  await page.goto('/en/?email=private@example.com#private');
  await expect(page.locator('#consent')).toBeVisible();
  expect(vendorRequests).toEqual([]);
  await page.locator('[data-consent="rejected"]').click();
  await page.reload();
  expect(vendorRequests).toEqual([]);
  await page.locator('[data-cookie-settings]').click();
  await page.locator('[data-consent="accepted"]').click();
  await expect(page.locator('#ga-tag')).toHaveCount(1);
  await page.route('https://chromewebstore.google.com/**', (route) =>
    route.abort(),
  );
  // Prevent navigation only in the test; exercise the actual click listener.
  await page
    .locator('[data-install][data-placement="hero"]')
    .evaluate((el) =>
      el.addEventListener('click', (event) => event.preventDefault()),
    );
  await page.locator('[data-install][data-placement="hero"]').click();
  const events = await page.evaluate(() =>
    (window.dataLayer || []).map((item) =>
      Array.from(item as ArrayLike<unknown>),
    ),
  );
  expect(events.some((event) => event[1] === 'install_click')).toBe(true);
  expect(JSON.stringify(events)).not.toContain('private');
  await page.locator('[data-cookie-settings]').click();
  const count = vendorRequests.length;
  await page.locator('[data-consent="rejected"]').click();
  await page.waitForLoadState();
  await expect(page.locator('#ga-tag')).toHaveCount(0);
  expect(vendorRequests.length).toBe(count);
});
test('keyboard, reduced motion and localized 404', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('fmf-consent', 'rejected'),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en/');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  expect(
    await page
      .locator('html')
      .evaluate((el) => getComputedStyle(el).scrollBehavior),
  ).toBe('auto');
  await page.locator('summary').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('details').first()).toHaveAttribute('open', '');
  const response = await page.goto('/ar/missing/');
  expect(response?.status()).toBe(404);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});
