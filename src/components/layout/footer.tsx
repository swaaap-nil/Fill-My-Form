import { browser } from "wxt/browser";

/**
 * Deliberately minimal. The starter's footer promoted its own GitHub and
 * author; a footer is a good place for the privacy posture instead, because it
 * appears on every surface.
 */
export const Footer = () => {
  return (
    <footer className="flex w-full justify-center">
      <p className="text-center text-muted-foreground text-xs">
        {browser.i18n.getMessage("privacyNote")}
      </p>
    </footer>
  );
};
