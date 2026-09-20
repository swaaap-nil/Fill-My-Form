import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  localeKeys,
  matchLocale,
  fromHeader,
  localizedPath,
} from '../src/lib/locales.ts';
import { validateConfig } from '../src/lib/config.ts';
import { validateStoreLinks } from '../src/lib/store-links.ts';

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
test('store link validation rejects unsafe URLs', () => {
  assert.throws(() =>
    validateStoreLinks({
      site: 'https://example.com/?token=x',
      chrome: '',
      firefox: '',
    }),
  );
  assert.throws(() =>
    validateStoreLinks({
      site: 'https://getfillmyform.store',
      chrome: 'https://evil.example/detail/test',
      firefox: '',
    }),
  );
  assert.throws(() =>
    validateStoreLinks({
      site: 'https://getfillmyform.store',
      chrome: '',
      firefox: 'https://evil.example/firefox/addon/test',
    }),
  );
  const firefox =
    'https://addons.mozilla.org/en-US/firefox/addon/fill-my-form/';
  assert.equal(
    validateStoreLinks({
      site: 'https://getfillmyform.store',
      chrome: '',
      firefox,
    }).firefox,
    firefox,
  );
});
test('launch config rejects invalid GA4 and enables GA only in production', () => {
  assert.equal(validateConfig({}).ga, '');
  assert.equal(validateConfig({ SITE_ENV: 'production' }).ga, '');
  assert.throws(() => validateConfig({ PUBLIC_GA4_ID: 'bad' }));
  assert.equal(
    validateConfig({ SITE_ENV: 'production', PUBLIC_GA4_ID: 'G-TEST123' }).ga,
    'G-TEST123',
  );
  assert.equal(
    validateConfig({ SITE_ENV: 'preview', PUBLIC_GA4_ID: 'G-TEST123' }).ga,
    '',
  );
  assert.ok(validateConfig({}).firefox.includes('fill-my-form'));
});
