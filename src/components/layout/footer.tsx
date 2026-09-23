import { Lock } from "lucide-react";
import { browser } from "wxt/browser";

import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * Deliberately minimal. The starter's footer promoted its own GitHub and
 * author; a footer is a good place for the privacy posture instead, because it
 * appears on every surface.
 */
export const Footer = ({ className }: { readonly className?: string }) => {
  const version = browser.runtime.getManifest().version;
  return (
    <footer className={cn("flex w-full justify-center", className)}>
      <p className="flex items-center justify-center gap-1 text-center text-muted-foreground text-xs">
        {browser.i18n.getMessage("privacyNote")}
        <a
          aria-label="Read the privacy policy"
          className={cn(
            buttonVariants({ size: "icon-xs", variant: "ghost" }),
            "text-muted-foreground hover:text-foreground",
          )}
          href="https://getfillmyform.store/en/privacy/"
          rel="noreferrer"
          target="_blank"
          title="Read the privacy policy"
        >
          <Lock className="size-3" />
        </a>
        <span
          className="opacity-50"
          title={`Version ${version}`}
          data-testid="footer-version"
        >
          · v{version}
        </span>
      </p>
    </footer>
  );
};
