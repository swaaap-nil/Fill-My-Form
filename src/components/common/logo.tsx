import { browser } from "wxt/browser";

/**
 * Product mark, authored as a component rather than imported through
 * `vite-plugin-svgr`: that plugin emits JSX from a `.svg` module id, which
 * Vite 8's rolldown parser refuses to parse. Removing it also removed a
 * dependency and the starter's branding.
 */
export const Logo = ({ className }: { readonly className?: string }) => (
  <svg
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    role="img"
    aria-label={browser.i18n.getMessage("logoAlt")}
  >
    <title>{browser.i18n.getMessage("logoAlt")}</title>
    <rect
      x="7"
      y="4"
      width="34"
      height="40"
      rx="5"
      stroke="currentColor"
      strokeWidth="3"
    />
    <path
      d="M15 15h18M15 23h18M15 31h9"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path
      d="m28.5 33.5 3.5 3.5 7-7.5"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
