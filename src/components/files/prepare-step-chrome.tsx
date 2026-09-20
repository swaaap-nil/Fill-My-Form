import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

/** Shared panel styling for numbered prepare-file steps. */
export const prepareStepPanelClass =
  "flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-2.5";

export const PrepareStepHeading = ({
  step,
  title,
  description,
}: {
  readonly step: 1 | 2 | 3;
  readonly title: ReactNode;
  readonly description?: ReactNode;
}) => (
  <div className="flex items-baseline gap-2">
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-[10px] text-primary"
    >
      {step}
    </span>
    <div className="min-w-0 space-y-0.5">
      <p className="font-medium text-foreground text-xs">{title}</p>
      {description ? (
        <p className="text-muted-foreground text-xs">{description}</p>
      ) : null}
    </div>
  </div>
);

export const PrepareStepBody = ({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) => <div className={cn("pl-7", className)}>{children}</div>;
