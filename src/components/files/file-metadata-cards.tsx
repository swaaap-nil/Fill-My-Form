import { Tooltip } from "@base-ui/react/tooltip";

import { formatBytes } from "~/core/files/byte-units";
import type { FileInspection } from "~/core/files/preparation";

const DPI_UNAVAILABLE_HELP =
  "Some images do not store DPI. That is okay: the pixels are still there. Only set DPI if the form asks for it.";

const MetadataHelpTooltip = ({ text }: { readonly text: string }) => (
  <Tooltip.Root>
    <Tooltip.Trigger
      type="button"
      delay={150}
      closeDelay={100}
      closeOnClick={false}
      className="cursor-help border-0 bg-transparent p-0 text-muted-foreground normal-case underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      why?
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Positioner side="top" align="start" sideOffset={8}>
        <Tooltip.Popup className="z-50 max-w-72 rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground text-xs shadow-lg">
          {text}
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>
);

const MetadataCard = ({
  label,
  value,
  help,
}: {
  readonly label: string;
  readonly value: string;
  readonly help?: string;
}) => (
  <div className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2">
    <p className="font-semibold text-foreground text-sm tabular-nums">
      {value}
    </p>
    <p className="flex items-center gap-1 text-muted-foreground text-[11px] uppercase">
      {label}
      {help ? <MetadataHelpTooltip text={help} /> : null}
    </p>
  </div>
);

const formatDimensions = (inspection: FileInspection) => {
  if (inspection.width && inspection.height) {
    return `${inspection.width} x ${inspection.height} px`;
  }
  if (inspection.pageCount) return `${inspection.pageCount} pages`;
  return "Unknown";
};

const formatDpi = (inspection: FileInspection) =>
  inspection.dpi ? `${Math.round(inspection.dpi.x)} DPI` : "Not available";

export const FileMetadataCards = ({
  inspection,
  sizeBytes = inspection.sizeBytes,
}: {
  readonly inspection: FileInspection;
  readonly sizeBytes?: number;
}) => (
  <div className="grid grid-cols-3 gap-2">
    <MetadataCard label="Size" value={formatBytes(sizeBytes)} />
    <MetadataCard label="Dimensions" value={formatDimensions(inspection)} />
    <MetadataCard
      label="DPI"
      value={formatDpi(inspection)}
      help={inspection.dpi ? undefined : DPI_UNAVAILABLE_HELP}
    />
  </div>
);
