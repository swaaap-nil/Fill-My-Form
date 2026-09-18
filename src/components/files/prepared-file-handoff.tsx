import {
  CheckCircle2,
  Download,
  FileImage,
  FileText,
  LoaderCircle,
} from "lucide-react";
import { type DragEvent, useEffect, useState } from "react";
import type { PreparedArtifact } from "~/core/files/preparation";
import type { FileReferenceStore } from "~/lib/files/adapters";
import { cn } from "~/lib/utils";
import { FileMetadataCards } from "./file-metadata-cards";

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
}: {
  readonly artifact: PreparedArtifact;
  readonly store: FileReferenceStore;
  readonly downloadUrl: string;
  readonly label?: string;
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
      event.dataTransfer.clearData();
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
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-emerald-500/35 bg-emerald-50/60 p-4 shadow-sm dark:bg-emerald-950/20">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
          <CheckCircle2 className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-base">Drag and drop the image</h2>
          <p className="text-muted-foreground text-xs">
            Original unchanged · {formatExpiry(artifact.derived.expiresAt)}
          </p>
        </div>
      </div>

      <fieldset
        data-testid="prepared-file-drag-surface"
        draggable={Boolean(dragFile)}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className={cn(
          "relative min-h-32 cursor-grab overflow-hidden rounded-md border border-emerald-500/25 bg-muted transition-colors active:cursor-grabbing",
          dragState === "dragging" &&
            "border-primary bg-primary/10 ring-2 ring-primary/35",
          dragState === "finished" &&
            "border-emerald-500/60 ring-2 ring-emerald-500/25",
          dragState === "failed" && "border-destructive/50 bg-destructive/10",
          !dragFile && "cursor-wait opacity-70",
        )}
        aria-label={`Drag prepared ${label} to your form upload box`}
      >
        <legend className="sr-only">
          Drag prepared {label} to your form upload box
        </legend>
        {isImage && previewUrl ? (
          <img
            src={previewUrl}
            alt={`Prepared ${label} preview`}
            draggable={false}
            className="pointer-events-none h-32 w-full select-none object-contain"
          />
        ) : (
          <div className="flex h-24 items-center justify-center gap-2 bg-background/60 text-muted-foreground text-xs">
            <FileText className="size-5" aria-hidden="true" />
            PDF copy prepared locally
          </div>
        )}
        {dragState === "loading" && (
          <div className="absolute inset-0 grid place-items-center bg-background/70">
            <LoaderCircle
              className="size-5 animate-spin text-primary"
              aria-hidden="true"
            />
          </div>
        )}
      </fieldset>

      {dragState === "failed" && (
        <p className="text-destructive text-xs">
          Drag was not accepted. Download the copy and choose it in the upload
          field.
        </p>
      )}

      <div className="flex items-start gap-2 rounded-md border border-emerald-500/25 bg-background/75 px-3 py-2 text-xs">
        {isImage ? (
          <FileImage
            className="mt-1 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
        ) : (
          <FileText
            className="mt-1 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <FileMetadataCards
            inspection={artifact.inspection}
            sizeBytes={artifact.sizeBytes}
          />
          <p className="truncate text-muted-foreground text-xs">
            {artifact.name}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <a
          href={downloadUrl}
          download={artifact.name}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 font-semibold text-primary-foreground text-sm shadow-sm hover:bg-[#dccdff]"
        >
          <Download className="size-4" aria-hidden="true" />
          Download prepared copy
        </a>
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
