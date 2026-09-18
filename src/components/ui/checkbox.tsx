import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "~/lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-card/80 shadow-xs transition-[color,box-shadow,border-color] outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 dark:bg-input/30",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <CheckIcon className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** A checkbox with its label, wired up so the text is part of the hit target. */
function CheckboxField({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  readonly id: string;
  readonly label: React.ReactNode;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
      <label
        htmlFor={id}
        className={cn(
          "cursor-pointer text-xs select-none",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {label}
      </label>
    </div>
  );
}

export { Checkbox, CheckboxField };
