import { Coffee } from "lucide-react";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import { BUY_ME_A_COFFEE_URL } from "~/lib/support-link";
import { cn } from "~/lib/utils";

/** Shown after a successful image prepare; delayed entrance so it reads as a win moment. */
export const PreparationSuccessSupport = ({
  className,
}: {
  readonly className?: string;
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), 1000);
    return () => window.clearTimeout(id);
  }, []);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[17rem] items-center gap-2 rounded-md border border-border border-l-2 border-l-amber-500/50 bg-card/60 px-2.5 py-1.5",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:fill-mode-both motion-reduce:animate-none",
        className,
      )}
      data-testid="preparation-success-support"
    >
      <Coffee
        aria-hidden
        className="size-3.5 shrink-0 text-amber-600/90 dark:text-amber-500/90 motion-safe:animate-[support-wiggle_2.5s_ease-in-out_0.55s_infinite] motion-reduce:animate-none"
      />
      <p className="min-w-0 flex-1 text-[11px] text-muted-foreground leading-snug">
        {browser.i18n.getMessage("supportPromptBody")}{" "}
        <a
          className="font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-400/95"
          href={BUY_ME_A_COFFEE_URL}
          rel="noreferrer"
          target="_blank"
        >
          {browser.i18n.getMessage("supportLink")}
        </a>
      </p>
    </div>
  );
};
