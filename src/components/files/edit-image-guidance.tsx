import { Tooltip } from "@base-ui/react/tooltip";
import { CircleHelp } from "lucide-react";
import { browser } from "wxt/browser";

import { cn } from "~/lib/utils";

type MessageKey = Parameters<typeof browser.i18n.getMessage>[0];

const message = (key: MessageKey) => browser.i18n.getMessage(key);

const guidanceSections = [
  {
    heading: "editImageGuidanceEditHeading",
    items: [
      "editImageGuidanceEditExtraBackground",
      "editImageGuidanceEditNotCentered",
      "editImageGuidanceEditFrameShape",
    ],
  },
  {
    heading: "editImageGuidanceOutputHeading",
    items: [
      "editImageGuidanceOutputPhysicalSize",
      "editImageGuidanceOutputPixelsDpi",
      "editImageGuidanceOutputFormatSize",
    ],
  },
] as const;

const EditImageGuidanceContent = () => (
  <div className="space-y-2">
    {guidanceSections.map((section) => (
      <div key={section.heading} className="space-y-1">
        <p className="font-medium">{message(section.heading)}</p>
        <ul className="list-disc space-y-1 pl-4">
          {section.items.map((item) => (
            <li key={item}>{message(item)}</li>
          ))}
        </ul>
      </div>
    ))}
  </div>
);

export const EditImageGuidanceTooltip = ({
  className,
}: {
  readonly className?: string;
}) => (
  <Tooltip.Root>
    <Tooltip.Trigger
      type="button"
      delay={150}
      closeDelay={100}
      closeOnClick={false}
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-sm text-muted-foreground text-xs underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/40",
        className,
      )}
    >
      <CircleHelp className="size-3.5" />
      {message("editImageGuidanceTrigger")}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Positioner side="top" align="start" sideOffset={8}>
        <Tooltip.Popup className="z-50 max-w-72 rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground text-xs shadow-lg">
          <EditImageGuidanceContent />
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>
);
