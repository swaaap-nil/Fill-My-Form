import { formatBytes } from "~/core/files/byte-units";
import type { FileInspection } from "~/core/files/preparation";

const DPI_UNAVAILABLE_HELP =
  "Some images do not store DPI. That is okay: the pixels are still there. Only set DPI if the form asks for it.";

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
      {help && (
        <button
          type="button"
          title={help}
          className="cursor-help border-0 bg-transparent p-0 text-muted-foreground normal-case underline decoration-dotted underline-offset-2"
        >
          why?
        </button>
      )}
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
