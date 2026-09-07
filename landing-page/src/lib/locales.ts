export const locales = {
  en: { name: 'English', tag: 'en', dir: 'ltr' },
  hi: { name: 'हिन्दी', tag: 'hi', dir: 'ltr' },
  es: { name: 'Español', tag: 'es', dir: 'ltr' },
  'pt-br': { name: 'Português (Brasil)', tag: 'pt-BR', dir: 'ltr' },
  fr: { name: 'Français', tag: 'fr', dir: 'ltr' },
  de: { name: 'Deutsch', tag: 'de', dir: 'ltr' },
  id: { name: 'Bahasa Indonesia', tag: 'id', dir: 'ltr' },
  ar: { name: 'العربية', tag: 'ar', dir: 'rtl' },
  ja: { name: '日本語', tag: 'ja', dir: 'ltr' },
  'zh-cn': { name: '简体中文', tag: 'zh-Hans', dir: 'ltr' },
} as const;
export type Locale = keyof typeof locales;
export const localeKeys = Object.keys(locales) as Locale[];
export function isLocale(value: string | undefined): value is Locale {
  return !!value && Object.hasOwn(locales, value);
}
export function matchLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const value = language.toLowerCase().trim();
    if (isLocale(value)) return value;
    if (value === 'pt' || value.startsWith('pt-')) return 'pt-br';
    // Do not silently serve Simplified Chinese to explicit Traditional preferences.
    if (value === 'zh' || value === 'zh-sg' || value.startsWith('zh-hans'))
      return 'zh-cn';
    const base = value.split('-')[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}
export function fromHeader(header: string): Locale {
  return matchLocale(
    header
      .split(',')
      .map((part, index) => {
        const [tag = '', ...params] = part.trim().split(';');
        const quality = params.find((p) => p.trim().startsWith('q='));
        return { tag, q: quality ? Number(quality.trim().slice(2)) : 1, index };
      })
      .filter(({ q }) => Number.isFinite(q) && q > 0 && q <= 1)
      .sort((a, b) => b.q - a.q || a.index - b.index)
      .map(({ tag }) => tag),
  );
}
export function localizedPath(locale: Locale, page = '') {
  return `/${locale}/${page ? `${page}/` : ''}`;
}
