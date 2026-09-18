import {
  FileImage,
  FileText,
  FileUp,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatBytes } from "~/core/files/byte-units";
import type {
  FileInspection,
  PreparationSpec,
  PreparedArtifact,
} from "~/core/files/preparation";
import type { FileReference } from "~/core/memory/types";
import {
  createIndexedDbFileReferenceStore,
  type FileReferenceStore,
} from "~/lib/files/adapters";
import { createBrowserFilePreparationRegistry } from "~/lib/files/preparation-registry";
import { cn } from "~/lib/utils";
import { PreparedFileHandoff } from "./prepared-file-handoff";

const PRESETS = {
  custom: { label: "Custom", width: "", height: "", ratio: "" },
  photograph: {
    label: "Photograph",
    width: "530",
    height: "690",
    ratio: "0.768",
  },
  signature: { label: "Signature", width: "580", height: "180", ratio: "3.22" },
  passport: {
    label: "Passport / ID photo",
    width: "600",
    height: "600",
    ratio: "1",
  },
} as const;

type Preset = keyof typeof PRESETS;

export const FilePreparationTool = () => {
  const [store, setStore] = useState<FileReferenceStore>();
  const [original, setOriginal] = useState<FileReference>();
  const [inspection, setInspection] = useState<FileInspection>();
  const [adapterAvailable, setAdapterAvailable] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [prepared, setPrepared] = useState<PreparedArtifact>();
  const [preparedUrl, setPreparedUrl] = useState<string>();
  const [preset, setPreset] = useState<Preset>("custom");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [ratio, setRatio] = useState("");
  const [maxBytes, setMaxBytes] = useState("");
  const [pageStart, setPageStart] = useState("1");
  const [pageEnd, setPageEnd] = useState("");
  const [pageWidth, setPageWidth] = useState("");
  const [pageHeight, setPageHeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ratioRef = useRef(ratio);
  const imageRef = useRef<HTMLImageElement>(null);
  const editorRef = useRef<{
    destroy(): void;
    setAspectRatio(ratio: number | undefined): void;
    resetCrop(): void;
    getCrop():
      | { x: number; y: number; width: number; height: number }
      | undefined;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void createIndexedDbFileReferenceStore().then((nextStore) => {
      if (active) setStore(nextStore);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      if (preparedUrl) URL.revokeObjectURL(preparedUrl);
    },
    [preparedUrl, sourceUrl],
  );

  useEffect(() => {
    if (!inspection || !imageRef.current || !store) return;
    const adapter =
      createBrowserFilePreparationRegistry(store).adapterFor(inspection);
    if (!adapter?.createEditor) return;
    let active = true;
    editorRef.current?.destroy();
    void adapter.createEditor(imageRef.current).then((editor) => {
      if (!active) {
        editor.destroy();
        return;
      }
      editorRef.current = editor;
      editor.setAspectRatio(
        ratioRef.current ? Number(ratioRef.current) : undefined,
      );
    });
    return () => {
      active = false;
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [inspection, store]);

  useEffect(() => {
    editorRef.current?.setAspectRatio(ratio ? Number(ratio) : undefined);
  }, [ratio]);

  ratioRef.current = ratio;

  const applyPreset = (nextPreset: Preset) => {
    setPreset(nextPreset);
    const next = PRESETS[nextPreset];
    setWidth(next.width);
    setHeight(next.height);
    setRatio(next.ratio);
  };

  const selectFile = async (file: File | undefined) => {
    if (!file || !store) return;
    setError(undefined);
    setPrepared(undefined);
    if (preparedUrl) URL.revokeObjectURL(preparedUrl);
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    try {
      const registry = createBrowserFilePreparationRegistry(store);
      const adapter = registry.adapterFor({
        kind: "image",
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!adapter) {
        setError(
          "This file type does not have a local preparation adapter yet.",
        );
        return;
      }
      const ref = await store.save(file);
      const nextInspection = await adapter.inspect(file);
      const nextUrl = URL.createObjectURL(file);
      setOriginal(ref);
      setInspection(nextInspection);
      setAdapterAvailable(true);
      setSourceUrl(nextUrl);
    } catch {
      setError(
        "This file could not be inspected locally. The original was not changed.",
      );
    }
  };

  const prepare = async () => {
    if (!store || !original || !inspection) return;
    const registry = createBrowserFilePreparationRegistry(store);
    const adapter = registry.adapterFor(inspection);
    if (!adapter) {
      setError("This file type does not have a local preparation adapter yet.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const spec: PreparationSpec = {
        targetWidth: width ? Number(width) : undefined,
        targetHeight: height ? Number(height) : undefined,
        aspectRatio: ratio
          ? { min: Number(ratio), max: Number(ratio) }
          : undefined,
        maxBytes: maxBytes ? Number(maxBytes) * 1024 : undefined,
        crop: editorRef.current?.getCrop(),
        pageRange:
          inspection.kind === "pdf"
            ? {
                start: Number(pageStart) || 1,
                end: Number(pageEnd) || inspection.pageCount || 1,
              }
            : undefined,
        pageWidth: pageWidth ? Number(pageWidth) : undefined,
        pageHeight: pageHeight ? Number(pageHeight) : undefined,
      };
      const result = await adapter.prepare(original, spec);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      if (preparedUrl) URL.revokeObjectURL(preparedUrl);
      setPrepared(result.artifact);
      setPreparedUrl(URL.createObjectURL(result.artifact.blob));
    } catch {
      setError("Local preparation failed. The original file was not changed.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (preparedUrl) URL.revokeObjectURL(preparedUrl);
    setOriginal(undefined);
    setInspection(undefined);
    setPrepared(undefined);
    setSourceUrl(undefined);
    setPreparedUrl(undefined);
    setError(undefined);
    setAdapterAvailable(false);
    applyPreset("custom");
  };

  const showCurrentPage = async () => {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id !== undefined) {
      await browser.tabs.update(tab.id, { active: true });
    }
  };

  const resetEditor = () => {
    if (inspection?.kind === "image") {
      editorRef.current?.resetCrop();
      return;
    }
    reset();
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
        <div>
          <h1 className="font-semibold text-sm">Prepare a file</h1>
          {!original && (
            <p className="text-muted-foreground text-xs">
              Create a temporary upload-ready copy locally. Your original file
              stays unchanged.
            </p>
          )}
        </div>
        <label
          className={cn(
            "flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/30 p-3 text-center hover:border-primary/60",
            original && "min-h-14",
          )}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void selectFile(event.dataTransfer.files[0]);
          }}
        >
          <FileUp className="size-5 text-muted-foreground" />
          <span className="font-medium text-sm">
            {original ? original.name : "Choose or drop a file"}
          </span>
          {!original && (
            <span className="text-muted-foreground text-xs">
              JPEG, PNG, WebP, or PDF
            </span>
          )}
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(event) =>
              void selectFile(event.currentTarget.files?.[0])
            }
          />
        </label>
      </section>

      {inspection && (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {inspection.kind === "pdf" ? (
                <FileText className="size-5 shrink-0 text-primary" />
              ) : (
                <FileImage className="size-5 shrink-0 text-primary" />
              )}
              <div className="min-w-0">
                <p className="truncate font-medium text-sm">
                  {inspection.name}
                </p>
                <p className="text-muted-foreground text-xs">
                  {inspection.mimeType} · {formatBytes(inspection.sizeBytes)}
                  {inspection.width &&
                    inspection.height &&
                    ` · ${inspection.width} × ${inspection.height}px`}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={resetEditor}
              aria-label={
                inspection.kind === "image"
                  ? "Reset crop"
                  : "Choose another file"
              }
              title={
                inspection.kind === "image"
                  ? "Reset crop"
                  : "Choose another file"
              }
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>

          {sourceUrl && inspection.kind === "image" && (
            <>
              <div className="crop-editor h-44 overflow-hidden rounded-md border bg-muted [&_cropper-canvas]:block [&_cropper-canvas]:h-full [&_cropper-canvas]:w-full">
                <img
                  ref={imageRef}
                  src={sourceUrl}
                  alt="Original file preview"
                  className="block max-w-full"
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Drag the selection to frame the image. Use the reset icon to
                restore the full image.
              </p>
            </>
          )}

          <label className="flex flex-col gap-1 text-xs">
            Preset
            <select
              className="h-9 rounded-md border border-input bg-card px-2"
              value={preset}
              onChange={(event) => applyPreset(event.target.value as Preset)}
            >
              {Object.entries(PRESETS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label
              htmlFor="prepare-width"
              className="flex flex-col gap-1 text-xs"
            >
              Target width (px)
              <Input
                id="prepare-width"
                type="number"
                min="1"
                value={width}
                onChange={(event) => setWidth(event.target.value)}
              />
            </label>
            <label
              htmlFor="prepare-height"
              className="flex flex-col gap-1 text-xs"
            >
              Target height (px)
              <Input
                id="prepare-height"
                type="number"
                min="1"
                value={height}
                onChange={(event) => setHeight(event.target.value)}
              />
            </label>
          </div>
          {inspection.kind === "pdf" && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
              <p className="font-medium text-xs">PDF options</p>
              <div className="grid grid-cols-2 gap-2">
                <label
                  htmlFor="prepare-page-start"
                  className="flex flex-col gap-1 text-xs"
                >
                  First page
                  <Input
                    id="prepare-page-start"
                    type="number"
                    min="1"
                    value={pageStart}
                    onChange={(event) => setPageStart(event.target.value)}
                  />
                </label>
                <label
                  htmlFor="prepare-page-end"
                  className="flex flex-col gap-1 text-xs"
                >
                  Last page
                  <Input
                    id="prepare-page-end"
                    type="number"
                    min="1"
                    placeholder={`${inspection.pageCount ?? 1}`}
                    value={pageEnd}
                    onChange={(event) => setPageEnd(event.target.value)}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label
                  htmlFor="prepare-page-width"
                  className="flex flex-col gap-1 text-xs"
                >
                  Page width (pt)
                  <Input
                    id="prepare-page-width"
                    type="number"
                    min="1"
                    placeholder="Keep original"
                    value={pageWidth}
                    onChange={(event) => setPageWidth(event.target.value)}
                  />
                </label>
                <label
                  htmlFor="prepare-page-height"
                  className="flex flex-col gap-1 text-xs"
                >
                  Page height (pt)
                  <Input
                    id="prepare-page-height"
                    type="number"
                    min="1"
                    placeholder="Keep original"
                    value={pageHeight}
                    onChange={(event) => setPageHeight(event.target.value)}
                  />
                </label>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label
              htmlFor="prepare-ratio"
              className="flex flex-col gap-1 text-xs"
            >
              Aspect ratio
              <Input
                id="prepare-ratio"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Optional"
                value={ratio}
                onChange={(event) => setRatio(event.target.value)}
              />
            </label>
            <label
              htmlFor="prepare-max-bytes"
              className="flex flex-col gap-1 text-xs"
            >
              Max size (KB)
              <Input
                id="prepare-max-bytes"
                type="number"
                min="1"
                placeholder="Optional"
                value={maxBytes}
                onChange={(event) => setMaxBytes(event.target.value)}
              />
            </label>
          </div>
          <Button
            type="button"
            disabled={busy || !adapterAvailable}
            onClick={() => void prepare()}
          >
            {busy ? (
              <>
                <LoaderCircle className="animate-spin" /> Preparing...
              </>
            ) : (
              "Prepare temporary copy"
            )}
          </Button>
          {error && <p className="text-destructive text-xs">{error}</p>}
        </section>
      )}

      {prepared && preparedUrl && store && (
        <PreparedFileHandoff
          artifact={prepared}
          store={store}
          downloadUrl={preparedUrl}
          label={PRESETS[preset].label.toLowerCase()}
          onShowCurrentPage={() => void showCurrentPage()}
        />
      )}
    </div>
  );
};
