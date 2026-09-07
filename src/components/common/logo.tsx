import { browser } from "wxt/browser";

/**
 * Product mark, authored as a component rather than imported through
 * `vite-plugin-svgr`: that plugin emits JSX from a `.svg` module id, which
 * Vite 8's rolldown parser refuses to parse. Removing it also removed a
 * dependency and the starter's branding.
 */
export const Logo = ({ className }: { readonly className?: string }) => (
  <svg
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    role="img"
    aria-label={browser.i18n.getMessage("logoAlt")}
  >
    <title>{browser.i18n.getMessage("logoAlt")}</title>
    <rect x="3" y="3" width="26" height="26" rx="8" fill="currentColor" />
    <path
      d="M10 11h12M10 16h7M10 21h4"
      stroke="var(--fmf-ink)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <path
      d="m19 21 2 2 5-6"
      stroke="var(--fmf-ink)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
