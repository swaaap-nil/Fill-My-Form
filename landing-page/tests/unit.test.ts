import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  localeKeys,
  firefoxStoreUrl,
  matchLocale,
  fromHeader,
  localizedPath,
} from '../src/lib/locales.ts';
import { validateConfig } from '../src/lib/config.ts';

test('language matching respects order, regions, scripts and English fallback', () => {
  assert.equal(matchLocale(['fr-CA', 'en']), 'fr');
  assert.equal(matchLocale(['xx', 'pt-PT']), 'pt-br');
  assert.equal(matchLocale(['zh-Hans-SG']), 'zh-cn');
  assert.equal(matchLocale(['zh-TW', 'ja']), 'ja');
  assert.equal(matchLocale(['unknown']), 'en');
  assert.equal(fromHeader('de;q=0,fr-CA;q=0.8,en;q=0.9'), 'en');
  assert.equal(fromHeader('ar;q=bogus,hi-IN;q=0.9'), 'hi');
  assert.equal(fromHeader('en;q=0.1,de;q=0.9'), 'de');
  assert.equal(localizedPath('ar', 'privacy'), '/ar/privacy/');
  assert.equal(
    firefoxStoreUrl('en'),
    'https://addons.mozilla.org/en-US/fill-my-form',
  );
  assert.equal(
    firefoxStoreUrl('pt-br'),
    'https://addons.mozilla.org/pt-BR/fill-my-form',
  );
});
function structure(value: unknown): unknown {
  if (typeof value === 'string') {
    assert.ok(value.trim());
    return 'string';
  }
  if (Array.isArray(value)) return value.map(structure);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      structure(child),
    ]),
  );
}
test('all ten dictionaries have the same complete shape and no old branding', () => {
  const base = structure(
    JSON.parse(
      readFileSync(new URL('../src/content/en.json', import.meta.url), 'utf8'),
    ),
  );
  for (const locale of localeKeys) {
    const raw = readFileSync(
      new URL(`../src/content/${locale}.json`, import.meta.url),
      'utf8',
    );
    assert.deepEqual(structure(JSON.parse(raw)), base, locale);
    assert.doesNotMatch(raw, /AI Form Agent|Fill my Form/);
  }
});
test('production launch rejects missing or unsafe configuration', () => {
  assert.equal(validateConfig({}).ga, '');
  assert.throws(() => validateConfig({ SITE_ENV: 'production' }));
  assert.throws(() =>
    validateConfig({ PUBLIC_SITE_URL: 'https://example.com/?token=x' }),
  );
  assert.throws(() =>
    validateConfig({
      PUBLIC_CHROME_STORE_URL: 'https://evil.example/detail/test',
    }),
  );
  assert.throws(() => validateConfig({ PUBLIC_GA4_ID: 'bad' }));
  const valid = {
    SITE_ENV: 'production',
    PUBLIC_SITE_URL: 'https://example.com',
    PUBLIC_CHROME_STORE_URL:
      'https://chromewebstore.google.com/detail/test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    PUBLIC_GA4_ID: 'G-TEST123',
    LAUNCH_REVIEWED: 'true',
  };
  assert.equal(validateConfig(valid).ga, 'G-TEST123');
  assert.equal(validateConfig({ ...valid, SITE_ENV: 'preview' }).ga, '');
  assert.equal(validateConfig({}).firefox, false);
  assert.equal(validateConfig({ FIREFOX_VERIFIED: 'true' }).firefox, true);
});
