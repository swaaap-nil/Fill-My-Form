import {
  Crop,
  FileImage,
  FileText,
  FileUp,
  LoaderCircle,
  RefreshCcw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { Button } from "~/components/ui/button";
import { formatBytes } from "~/core/files/byte-units";
import type {
  FileInspection,
  PreparedArtifact,
} from "~/core/files/preparation";
import { CUSTOM_PRESET_ID, presetById } from "~/core/files/presets";
import type { FileReference } from "~/core/memory/types";
import {
  createIndexedDbFileReferenceStore,
  type FileReferenceStore,
} from "~/lib/files/adapters";
import { createBrowserFilePreparationRegistry } from "~/lib/files/preparation-registry";
import { cn } from "~/lib/utils";
import { PreparationSettings } from "./preparation-settings";
import { PreparedFileHandoff } from "./prepared-file-handoff";
import { usePreparationSettings } from "./use-preparation-settings";

export const FilePreparationTool = () => {
  /**
   * Opened once, as a promise the handlers await. Holding only the resolved
   * store in state meant a file chosen before IndexedDB finished opening was
   * dropped on the floor with no error and no visible effect — a race the user
   * could only lose by being quick.
   */
  const [storePromise] = useState(() => createIndexedDbFileReferenceStore());
  const [store, setStore] = useState<FileReferenceStore>();
  const [original, setOriginal] = useState<FileReference>();
  const [inspection, setInspection] = useState<FileInspection>();
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [prepared, setPrepared] = useState<PreparedArtifact>();
  const [preparedUrl, setPreparedUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const settings = usePreparationSettings(inspection);

  useEffect(() => {
    let active = true;
    void storePromise.then((nextStore) => {
      if (active) setStore(nextStore);
    });
    return () => {
      active = false;
    };
  }, [storePromise]);

  useEffect(
    () => () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      if (preparedUrl) URL.revokeObjectURL(preparedUrl);
    },
    [preparedUrl, sourceUrl],
  );

  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    setPrepared(undefined);
    if (preparedUrl) URL.revokeObjectURL(preparedUrl);
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    try {
      const store = await storePromise;
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
      setOriginal(ref);
      setInspection(nextInspection);
      settings.resetFor(nextInspection);
      setSourceUrl(URL.createObjectURL(file));
    } catch {
      setError(
        "This file could not be inspected locally. The original was not changed.",
      );
    }
  };

  const prepare = async () => {
    if (!original || !inspection || !settings.spec) return;
    setBusy(true);
    setError(undefined);
    try {
      const store = await storePromise;
      const registry = createBrowserFilePreparationRegistry(store);
      const adapter = registry.adapterFor(inspection);
      if (!adapter) {
        setError(
          "This file type does not have a local preparation adapter yet.",
        );
        return;
      }
      const result = await adapter.prepare(original, settings.spec);
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
    settings.resetFor(undefined);
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

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Once a file is chosen the details card below carries the heading's
          job, so the intro collapses rather than leaving an empty box. */}
      <section
        className={cn(
          "flex flex-col gap-2",
          !original && "rounded-lg border border-border bg-card p-3 shadow-sm",
        )}
      >
        <div>
          <h1 className={cn("font-semibold text-sm", original && "sr-only")}>
            Prepare a file
          </h1>
          {!original && (
            <p className="text-muted-foreground text-xs">
              Create a temporary upload-ready copy locally. Your original file
              stays unchanged.
            </p>
          )}
        </div>
        {!original && (
          <label
            className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/30 p-3 text-center hover:border-primary/60"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void selectFile(event.dataTransfer.files[0]);
            }}
          >
            <FileUp className="size-5 text-muted-foreground" />
            <span className="font-medium text-sm">Choose or drop a file</span>
            <span className="text-muted-foreground text-xs">
              JPEG, PNG, WebP, or PDF
            </span>
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(event) =>
                void selectFile(event.currentTarget.files?.[0])
              }
            />
          </label>
        )}
        {/* Selection errors have to live here, not in the details card below:
            a file that fails to inspect never produces one, so an error
            rendered there would be unreachable exactly when it matters. */}
        {error && !inspection && (
          <p className="text-destructive text-xs">{error}</p>
        )}
      </section>

      {inspection && (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
          {/* The chosen file, stated once. The dropzone used to repeat the
              name directly above this card. */}
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
                  {formatBytes(inspection.sizeBytes)}
                  {inspection.width &&
                    inspection.height &&
                    ` · ${inspection.width} × ${inspection.height} px`}
                  {inspection.dpi && ` · ${Math.round(inspection.dpi.x)} DPI`}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 font-normal"
              onClick={reset}
            >
              <RefreshCcw className="size-3.5" />
              Replace
            </Button>
          </div>

          {sourceUrl && inspection.kind === "image" && (
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 p-2">
              <img
                src={sourceUrl}
                alt=""
                className="size-16 shrink-0 rounded object-contain"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-muted-foreground text-xs">
                  {settings.values.crop
                    ? `Cropped to ${Math.round(settings.values.crop.width)} × ${Math.round(settings.values.crop.height)} px`
                    : "Using the whole image"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit font-normal"
                  disabled
                  title="The full editor arrives in the next change"
                >
                  <Crop className="size-3.5" />
                  Edit image
                </Button>
              </div>
            </div>
          )}

          <PreparationSettings
            inspection={inspection}
            settings={settings}
            layout="column"
          />

          <Button type="button" disabled={busy} onClick={() => void prepare()}>
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
          // The preset names the thing being dragged ("drag this signature to
          // your form"). Custom names nothing, so fall back to the generic
          // noun rather than saying "drag this custom to your form".
          label={
            settings.values.presetId === CUSTOM_PRESET_ID
              ? undefined
              : presetById(settings.values.presetId)?.label.toLowerCase()
          }
          onShowCurrentPage={() => void showCurrentPage()}
        />
      )}
    </div>
  );
};
