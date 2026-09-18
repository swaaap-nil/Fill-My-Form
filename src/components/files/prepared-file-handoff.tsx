import {
  CheckCircle2,
  Download,
  FileImage,
  FileText,
  Grip,
  LoaderCircle,
  MousePointer2,
} from "lucide-react";
import { type DragEvent, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { formatBytes } from "~/core/files/byte-units";
import type { PreparedArtifact } from "~/core/files/preparation";
import type { FileReferenceStore } from "~/lib/files/adapters";
import { cn } from "~/lib/utils";

type DragState = "loading" | "ready" | "dragging" | "finished" | "failed";

const formatExpiry = (expiresAt?: string) => {
  if (!expiresAt) return "temporary copy";
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime())
    ? "temporary copy"
    : `expires ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};

export const PreparedFileHandoff = ({
  artifact,
  store,
  downloadUrl,
  label = "file",
  onShowCurrentPage,
}: {
  readonly artifact: PreparedArtifact;
  readonly store: FileReferenceStore;
  readonly downloadUrl: string;
  readonly label?: string;
  readonly onShowCurrentPage?: () => void;
}) => {
  const [dragFile, setDragFile] = useState<File>();
  const [dragState, setDragState] = useState<DragState>("loading");
  const [previewUrl, setPreviewUrl] = useState<string>();

  useEffect(() => {
    let active = true;
    setDragState("loading");
    void store.getFile(artifact.derived.id).then((file) => {
      if (!active) return;
      setDragFile(file ?? undefined);
      setDragState(file ? "ready" : "failed");
    });
    return () => {
      active = false;
    };
  }, [artifact.derived.id, store]);

  useEffect(() => {
    if (!artifact.mimeType.startsWith("image/")) {
      setPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(artifact.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [artifact.blob, artifact.mimeType]);

  const handleDragStart = (event: DragEvent<HTMLFieldSetElement>) => {
    if (!dragFile) {
      event.preventDefault();
      setDragState("failed");
      return;
    }
    try {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.items.add(dragFile);
      event.dataTransfer.setData("text/plain", dragFile.name);
      setDragState("dragging");
    } catch {
      event.preventDefault();
      setDragState("failed");
    }
  };

  const handleDragEnd = () => setDragState("finished");
  const isImage = artifact.mimeType.startsWith("image/");
  const dimensions =
    artifact.inspection.width && artifact.inspection.height
      ? `${artifact.inspection.width} × ${artifact.inspection.height}px`
      : artifact.inspection.pageCount
        ? `${artifact.inspection.pageCount} pages`
        : undefined;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-emerald-500/35 bg-emerald-50/60 p-4 shadow-sm dark:bg-emerald-950/20">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
          <CheckCircle2 className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-base">Ready to upload</h2>
          <p className="text-muted-foreground text-xs">
            Original unchanged · {formatExpiry(artifact.derived.expiresAt)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-background/75 px-3 py-2 text-xs">
        {isImage ? (
          <FileImage
            className="size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
        ) : (
          <FileText
            className="size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 truncate font-medium">{artifact.name}</span>
        <span className="ml-auto shrink-0 text-muted-foreground">
          {formatBytes(artifact.sizeBytes)}
          {dimensions ? ` · ${dimensions}` : ""}
        </span>
      </div>

      {isImage && previewUrl ? (
        <img
          src={previewUrl}
          alt={`Prepared ${label} preview`}
          className="h-32 w-full rounded-md border border-emerald-500/20 bg-muted object-contain"
        />
      ) : (
        <div className="flex h-20 items-center justify-center gap-2 rounded-md border border-emerald-500/20 bg-background/60 text-muted-foreground text-xs">
          <FileText className="size-5" aria-hidden="true" />
          PDF copy prepared locally
        </div>
      )}

      <fieldset
        data-testid="prepared-file-drag-surface"
        draggable={Boolean(dragFile)}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className={cn(
          "flex min-h-20 cursor-grab flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-primary/45 bg-primary/10 px-4 py-3 text-center transition-colors active:cursor-grabbing",
          dragState === "dragging" && "border-primary bg-primary/20",
          dragState === "finished" &&
            "border-emerald-500/60 bg-emerald-100/70 dark:bg-emerald-900/30",
          dragState === "failed" && "border-destructive/50 bg-destructive/10",
          !dragFile && "cursor-wait opacity-70",
        )}
        aria-label={`Drag prepared ${label} to your form upload box`}
      >
        <legend className="sr-only">
          Drag prepared {label} to your form upload box
        </legend>
        {dragState === "loading" ? (
          <LoaderCircle
            className="size-5 animate-spin text-primary"
            aria-hidden="true"
          />
        ) : dragState === "finished" ? (
          <CheckCircle2
            className="size-5 text-emerald-600"
            aria-hidden="true"
          />
        ) : dragState === "failed" ? (
          <MousePointer2
            className="size-5 text-destructive"
            aria-hidden="true"
          />
        ) : (
          <Grip className="size-5 text-primary" aria-hidden="true" />
        )}
        <p className="font-semibold text-sm">
          {dragState === "finished"
            ? "Drop attempt finished"
            : dragState === "failed"
              ? "Drag was not accepted"
              : `Drag this ${label} to your form`}
        </p>
        <p className="text-muted-foreground text-xs">
          {dragState === "failed"
            ? "Download the copy and choose it in the upload field."
            : "Drop it on the form’s upload box"}
        </p>
      </fieldset>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <a
          href={downloadUrl}
          download={artifact.name}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 font-semibold text-primary-foreground text-sm shadow-sm hover:bg-[#dccdff]"
        >
          <Download className="size-4" aria-hidden="true" />
          Download prepared copy
        </a>
        {onShowCurrentPage && (
          <Button type="button" variant="outline" onClick={onShowCurrentPage}>
            <MousePointer2 className="size-4" aria-hidden="true" />
            Show current page
          </Button>
        )}
      </div>

      <p
        className="text-center text-muted-foreground text-[11px]"
        aria-live="polite"
      >
        {artifact.name} is a temporary local copy. It will not change your
        original file.
      </p>
    </section>
  );
};
