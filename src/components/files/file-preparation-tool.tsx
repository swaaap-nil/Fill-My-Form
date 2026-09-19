import {
  Crop,
  FileImage,
  FileText,
  FileUp,
  LoaderCircle,
  RefreshCcw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { Button } from "~/components/ui/button";
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
import {
  clearEditorSession,
  loadEditorSession,
  purgeStaleEditorSessions,
  updateEditorSession,
  watchEditorSession,
} from "~/lib/files/editor-session";
import {
  focusPreparationEditor,
  openPreparationEditor,
} from "~/lib/files/editor-window";
import { createBrowserFilePreparationRegistry } from "~/lib/files/preparation-registry";
import { cn } from "~/lib/utils";
import { FileMetadataCards } from "./file-metadata-cards";
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
  const [editing, setEditing] = useState<{
    sessionId: string;
    windowId?: number;
  }>();
  const editorWatch = useRef<(() => void) | null>(null);
  const storedRefIds = useRef<Set<string>>(new Set());

  const settings = usePreparationSettings(inspection);
  const { setValues } = settings;

  useEffect(() => {
    let active = true;
    void storePromise.then((nextStore) => {
      if (active) setStore(nextStore);
    });
    // Sessions whose window is gone, or that were left open while the panel
    // was closed, have nothing coming back for them.
    void purgeStaleEditorSessions();
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

  useEffect(() => () => editorWatch.current?.(), []);

  useEffect(
    () => () => {
      const ids = [...storedRefIds.current];
      storedRefIds.current.clear();
      void storePromise.then((store) =>
        Promise.all(ids.map((id) => store.delete(id))),
      );
    },
    [storePromise],
  );

  const deleteStoredRefs = useCallback(
    async (ids: Iterable<string>) => {
      const unique = [...new Set(ids)].filter((id) =>
        storedRefIds.current.has(id),
      );
      if (!unique.length) return;
      const store = await storePromise;
      await Promise.all(unique.map((id) => store.delete(id)));
      for (const id of unique) storedRefIds.current.delete(id);
    },
    [storePromise],
  );

  /**
   * The editor window's result comes back through `storage.session`. The panel
   * may have been closed when it was written, so this also reconciles whatever
   * the session already says rather than relying on catching the change live.
   */
  const adoptEditorResult = useCallback(
    async (sessionId: string) => {
      const session = await loadEditorSession(sessionId);
      if (!session || session.status === "open") return;

      if (session.status === "saved" && session.derivedId) {
        const store = await storePromise;
        const record = await store.get(session.derivedId);
        if (record) {
          await deleteStoredRefs(prepared ? [prepared.derived.id] : []);
          storedRefIds.current.add(record.ref.id);
          if (preparedUrl) URL.revokeObjectURL(preparedUrl);
          setPrepared({
            original: original ?? record.ref,
            derived: record.ref,
            blob: record.blob,
            name: record.ref.name,
            mimeType: record.ref.mimeType,
            sizeBytes: record.ref.sizeBytes,
            transformed: true,
            inspection: {
              kind: "image",
              name: record.ref.name,
              mimeType: record.ref.mimeType,
              sizeBytes: record.ref.sizeBytes,
            },
            validation: ["Prepared in the image editor"],
          });
          setPreparedUrl(URL.createObjectURL(record.blob));
          setValues(session.values);
        }
      } else if (session.status === "failed") {
        setError(session.reason ?? "The image editor could not finish.");
      }

      editorWatch.current?.();
      editorWatch.current = null;
      setEditing(undefined);
      await clearEditorSession(sessionId);
    },
    [
      storePromise,
      deleteStoredRefs,
      prepared,
      preparedUrl,
      original,
      setValues,
    ],
  );

  const openEditor = async () => {
    if (!original) return;
    // A second click focuses the window that is already open rather than
    // opening a rival copy of the same edit.
    if (editing?.windowId !== undefined) {
      if (await focusPreparationEditor(editing.windowId)) return;
    }
    setError(undefined);
    const opened = await openPreparationEditor({
      originalId: original.id,
      values: settings.values,
    });
    setEditing(opened);

    editorWatch.current?.();
    editorWatch.current = watchEditorSession(opened.sessionId, (session) => {
      if (session.status !== "open") void adoptEditorResult(opened.sessionId);
    });

    // The guarantee behind the editor's best-effort `pagehide` write: if the
    // window is closed with the X, the panel notices and closes the session
    // itself.
    if (opened.windowId !== undefined) {
      const onRemoved = (closedId: number) => {
        if (closedId !== opened.windowId) return;
        browser.windows.onRemoved.removeListener(onRemoved);
        void updateEditorSession(opened.sessionId, {
          status: "cancelled",
        }).then(() => adoptEditorResult(opened.sessionId));
      };
      browser.windows.onRemoved.addListener(onRemoved);
    }
  };

  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    setPrepared(undefined);
    await deleteStoredRefs([
      ...(original ? [original.id] : []),
      ...(prepared ? [prepared.derived.id] : []),
    ]);
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
      storedRefIds.current.add(ref.id);
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
      await deleteStoredRefs(prepared ? [prepared.derived.id] : []);
      storedRefIds.current.add(result.artifact.derived.id);
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
    void deleteStoredRefs([
      ...(original ? [original.id] : []),
      ...(prepared ? [prepared.derived.id] : []),
    ]);
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
              <div className="min-w-0 space-y-2">
                <FileMetadataCards inspection={inspection} />
                <p className="truncate text-muted-foreground text-xs">
                  {inspection.name}
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
                <p className="text-muted-foreground text-xs">
                  Crop selects the part of the picture you want to keep.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit font-normal"
                  onClick={() => void openEditor()}
                >
                  <Crop className="size-3.5" />
                  {editing ? "Editing in window" : "Edit image"}
                </Button>
              </div>
            </div>
          )}

          <PreparationSettings inspection={inspection} settings={settings} />

          <p className="text-muted-foreground text-xs">
            This creates a new upload-ready copy. Your original file stays
            unchanged.
          </p>
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
          // The preset names the preview for screen readers. Custom names
          // nothing, so fall back to the generic noun.
          label={
            settings.values.presetId === CUSTOM_PRESET_ID
              ? undefined
              : presetById(settings.values.presetId)?.label.toLowerCase()
          }
        />
      )}
    </div>
  );
};
