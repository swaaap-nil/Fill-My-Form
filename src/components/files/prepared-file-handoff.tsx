import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileImage,
  FileText,
  LoaderCircle,
} from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import type { PreparedArtifact } from "~/core/files/preparation";
import type { FileReferenceStore } from "~/lib/files/adapters";
import { useSound } from "~/lib/sfx/react";
import { cn } from "~/lib/utils";
import { FileMetadataCards } from "./file-metadata-cards";
import { useObjectUrl } from "./use-object-url";

type DragState = "loading" | "ready" | "dragging" | "finished" | "failed";
type CopyState = "idle" | "copying" | "copied" | "failed";

const createHandoffFile = (blob: Blob, name: string, mimeType: string): File =>
  new File([blob], name, {
    type: mimeType || "application/octet-stream",
    lastModified: Date.now(),
  });

const writeFileToClipboard = async (file: File): Promise<void> => {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Clipboard is unavailable.");
  }
  const type = file.type || "application/octet-stream";
  await navigator.clipboard.write([
    new ClipboardItem({
      [type]: file,
    }),
  ]);
};

export const PreparedFileHandoff = ({
  artifact,
  store,
  label = "file",
}: {
  readonly artifact: PreparedArtifact;
  readonly store: FileReferenceStore;
  readonly label?: string;
}) => {
  const sound = useSound();
  const previewImgRef = useRef<HTMLImageElement>(null);
  const [dragFile, setDragFile] = useState<File>();
  const [dragState, setDragState] = useState<DragState>("loading");
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const isImage = artifact.mimeType.startsWith("image/");
  const previewUrl = useObjectUrl(isImage ? artifact.blob : undefined);
  const downloadUrl = useObjectUrl(artifact.blob);

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

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    const file =
      dragFile ??
      (artifact.blob.size > 0
        ? createHandoffFile(artifact.blob, artifact.name, artifact.mimeType)
        : undefined);
    if (!file) {
      event.preventDefault();
      setDragState("failed");
      sound.play("fileDragFailed");
      return;
    }
    try {
      event.dataTransfer.clearData();
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.dropEffect = "copy";
      event.dataTransfer.items.add(
        createHandoffFile(file, file.name, file.type),
      );
      if (previewImgRef.current) {
        const { width, height } = previewImgRef.current.getBoundingClientRect();
        event.dataTransfer.setDragImage(
          previewImgRef.current,
          width / 2,
          height / 2,
        );
      }
      setDragState("dragging");
      sound.play("fileDragStarted");
    } catch {
      event.preventDefault();
      setDragState("failed");
      sound.play("fileDragFailed");
    }
  };

  const handleDragEnd = () => {
    setDragState("finished");
    sound.play("fileDragFinished");
  };

  const copyPreparedFile = async () => {
    const file =
      dragFile ??
      createHandoffFile(artifact.blob, artifact.name, artifact.mimeType);
    setCopyState("copying");
    try {
      await writeFileToClipboard(file);
      setCopyState("copied");
      sound.play("filePrepareSucceeded");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
      sound.play("filePrepareFailed");
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-emerald-500/35 bg-emerald-50/60 p-4 shadow-sm dark:bg-emerald-950/20">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
          <CheckCircle2 className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-base">Drag and drop the file</h2>
          <p className="text-muted-foreground text-xs">
            Drop onto the form’s upload area. Side panel drags are not always
            accepted like a file from Finder—use copy or download if drop fails.
          </p>
        </div>
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: fieldset breaks native file drag from the handoff surface */}
      <div
        role="group"
        aria-label={`Drag prepared ${label} to your form upload box`}
        data-testid="prepared-file-drag-surface"
        draggable={Boolean(dragFile) || artifact.blob.size > 0}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className={cn(
          "relative min-h-32 cursor-grab overflow-hidden rounded-md border border-emerald-500/25 bg-muted transition-colors active:cursor-grabbing",
          dragState === "dragging" &&
            "border-primary bg-primary/10 ring-2 ring-primary/35",
          dragState === "finished" &&
            "border-emerald-500/60 ring-2 ring-emerald-500/25",
          dragState === "failed" && "border-destructive/50 bg-destructive/10",
          !dragFile && artifact.blob.size === 0 && "cursor-wait opacity-70",
        )}
      >
        {isImage && previewUrl ? (
          <img
            ref={previewImgRef}
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
      </div>

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

      <div className="flex flex-col gap-2">
        <a
          href={downloadUrl ?? "#"}
          download={artifact.name}
          aria-disabled={!downloadUrl}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 font-semibold text-primary-foreground text-sm shadow-sm hover:bg-[#dccdff]"
        >
          <Download className="size-4" aria-hidden="true" />
          Download prepared copy
        </a>
        <Button
          type="button"
          variant="outline"
          className="h-9 font-semibold"
          disabled={
            copyState === "copying" || (!dragFile && !artifact.blob.size)
          }
          data-testid="copy-prepared-file"
          onClick={() => void copyPreparedFile()}
        >
          {copyState === "copying" ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Copying...
            </>
          ) : copyState === "copied" ? (
            <>
              <Check className="size-4" aria-hidden="true" />
              Copied to clipboard
            </>
          ) : (
            <>
              <Copy className="size-4" aria-hidden="true" />
              Copy to clipboard
            </>
          )}
        </Button>
      </div>
      {copyState === "failed" && (
        <p className="text-destructive text-xs">
          Copy was not accepted. Download the file and choose it in the upload
          field.
        </p>
      )}

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
