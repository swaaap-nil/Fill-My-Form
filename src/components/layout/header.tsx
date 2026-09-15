import { browser } from "wxt/browser";
import { Logo } from "~/components/common/logo";

export const Header = () => {
  return (
    <header className="flex w-full items-center gap-3 rounded-lg border border-border bg-card/90 p-3 shadow-sm shadow-black/5 dark:shadow-black/20">
      <div className="flex min-w-0 items-center gap-2">
        <Logo className="size-8 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-sm leading-tight">
            {browser.i18n.getMessage("extensionName")}
          </p>
          <p className="truncate text-muted-foreground text-xs">
            {browser.i18n.getMessage("headerSubtitle")}
          </p>
        </div>
      </div>
    </header>
  );
};
