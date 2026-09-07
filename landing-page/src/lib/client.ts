import { isLocale, localizedPath, matchLocale } from './locales';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Preferences remain session-only if storage is unavailable. */
  }
};
const language = document.querySelector<HTMLSelectElement>('[data-language]');
language?.addEventListener('change', () => {
  const value = language.value;
  const locale =
    value === 'auto'
      ? matchLocale(navigator.languages)
      : isLocale(value)
        ? value
        : 'en';
  document.cookie =
    value === 'auto'
      ? 'fmf-language=; Path=/; Max-Age=0; SameSite=Lax'
      : `fmf-language=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  const page = document.body.dataset.page || '';
  location.assign(localizedPath(locale, page) + location.hash);
});

const demo = document.querySelector<HTMLElement>('[data-demo]');
const fill = document.querySelector<HTMLButtonElement>('[data-fill]');
fill?.addEventListener('click', () => {
  const active = demo?.classList.toggle('is-filled');
  const label = fill.querySelector('[data-fill-text]');
  if (label)
    label.textContent =
      (active ? fill.dataset.resetLabel : fill.dataset.fillLabel) || '';
  const status = document.querySelector<HTMLElement>('[data-demo-status]');
  if (status)
    status.textContent =
      (active ? status.dataset.filled : status.dataset.empty) || '';
});

const dialog = document.querySelector<HTMLDialogElement>('#consent');
const ga = document.body.dataset.ga || '';
let consent = read('fmf-consent');
let loaded = false;
let returnFocus: HTMLElement | null = null;
const gaWindow = window as unknown as Window & Record<string, unknown>;
function track(
  event: 'page_view' | 'install_click',
  params: Record<string, string> = {},
) {
  if (consent !== 'accepted' || !ga || !loaded) return;
  window.gtag?.('event', event, {
    page_location: location.origin + location.pathname,
    page_referrer: '',
    page_title: document.title,
    language: document.body.dataset.locale,
    ...params,
  });
}
function startAnalytics() {
  if (!ga || consent !== 'accepted' || loaded) return;
  loaded = true;
  gaWindow[`ga-disable-${ga}`] = false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer!.push(arguments);
  };
  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  window.gtag('js', new Date());
  window.gtag('config', ga, {
    send_page_view: false,
    page_location: location.origin + location.pathname,
    page_referrer: '',
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${ga}`;
  script.id = 'ga-tag';
  document.head.append(script);
  track('page_view');
}
function eraseAnalyticsCookies() {
  const parts = location.hostname.split('.');
  const domains = [
    '',
    ...parts.map((_, i) => `; Domain=${parts.slice(i).join('.')}`),
  ];
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim();
    if (name === '_ga' || name?.startsWith('_ga_')) {
      for (const domain of domains)
        document.cookie = `${name}=; Max-Age=0; Path=/${domain}; SameSite=Lax`;
    }
  }
}
const openSettings = () => {
  returnFocus = document.activeElement as HTMLElement;
  if (dialog && !dialog.open) dialog.showModal();
};
document
  .querySelectorAll('[data-cookie-settings]')
  .forEach((button) => button.addEventListener('click', openSettings));
document
  .querySelector('[data-consent-close]')
  ?.addEventListener('click', () => dialog?.close());
dialog?.addEventListener('close', () => returnFocus?.focus());
document
  .querySelectorAll<HTMLButtonElement>('[data-consent]')
  .forEach((button) =>
    button.addEventListener('click', () => {
      const previous = consent;
      consent = button.dataset.consent || 'rejected';
      write('fmf-consent', consent);
      dialog?.close();
      if (consent === 'accepted') startAnalytics();
      else {
        if (ga) gaWindow[`ga-disable-${ga}`] = true;
        document.querySelector('#ga-tag')?.remove();
        eraseAnalyticsCookies();
        // Unload all previously initialized vendor listeners after withdrawal.
        if (loaded && previous === 'accepted') location.reload();
      }
    }),
  );
if (consent === 'accepted') startAnalytics();
else if (!consent && ga) openSettings();
document.querySelectorAll<HTMLAnchorElement>('[data-install]').forEach((link) =>
  link.addEventListener('click', () => {
    track('install_click', {
      browser_target: link.dataset.install || 'chrome',
      cta_placement: link.dataset.placement || 'hero',
    });
  }),
);
