import {
  Crop,
  FileCheck2,
  FileImage,
  FileText,
  FileUp,
  LoaderCircle,
  RefreshCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { formatBytes } from "~/core/files/byte-units";
import type {
  FileInspection,
  PreparedArtifact,
} from "~/core/files/preparation";
import {
  type PreparationFormValues,
  preparationFormValuesEqual,
  resolvePrepareInput,
  snapshotPreparationFormValues,
} from "~/core/files/preparation-form";
import { CUSTOM_PRESET_ID, presetById } from "~/core/files/presets";
import { type FileReference, isFileReference } from "~/core/memory/types";
import { concepts } from "~/core/ontology";
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
import { sendMessage } from "~/lib/messaging";
import { useSound } from "~/lib/sfx/react";
import { cn } from "~/lib/utils";
import { EditImageGuidanceTooltip } from "./edit-image-guidance";
import { FileMetadataCards } from "./file-metadata-cards";
import { PreparationSettings } from "./preparation-settings";
import { PreparationSuccessSupport } from "./preparation-success-support";
import {
  PrepareStepBody,
  PrepareStepHeading,
  prepareStepPanelClass,
} from "./prepare-step-chrome";
import { PreparedFileHandoff } from "./prepared-file-handoff";
import { useObjectUrl } from "./use-object-url";
import { usePreparationSettings } from "./use-preparation-settings";

interface SavedDocument {
  readonly key: string;
  readonly label: string;
  readonly ref: FileReference;
  readonly supported: boolean;
}

const fileConceptLabels = new Map(
  concepts
    .filter((concept) => concept.expects === "file")
    .map((concept) => [concept.key, concept.label]),
);

const canPrepareSavedDocument = (ref: FileReference): boolean =>
  ref.mimeType.startsWith("image/") || ref.mimeType === "application/pdf";

const SAVED_DOCUMENT_PLACEHOLDER = "saved-document-placeholder";
type SourceMode = "saved" | "upload";

interface EditorCropDraft {
  readonly derived: FileReference;
  readonly blob: Blob;
  readonly inspection: FileInspection;
}

const sourceInspectionFor = (ref: FileReference): FileInspection => ({
  kind: "unsupported",
  name: ref.name,
  mimeType: ref.mimeType,
  sizeBytes: ref.sizeBytes,
});

export const FilePreparationTool = () => {
  const sound = useSound();
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
  const [sourceFile, setSourceFile] = useState<File>();
  const [prepared, setPrepared] = useState<PreparedArtifact>();
  const [editorCrop, setEditorCrop] = useState<EditorCropDraft>();
  const [valuesWhenPrepared, setValuesWhenPrepared] =
    useState<PreparationFormValues>();
  const [savedDocuments, setSavedDocuments] = useState<
    readonly SavedDocument[]
  >([]);
  const [selectedSavedDocumentKey, setSelectedSavedDocumentKey] = useState(
    SAVED_DOCUMENT_PLACEHOLDER,
  );
  const [sourceMode, setSourceMode] = useState<SourceMode>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<{
    sessionId: string;
    windowId?: number;
  }>();
  const editorWatch = useRef<(() => void) | null>(null);
  const editorWindowRemoved = useRef<((closedId: number) => void) | null>(null);
  const storedRefIds = useRef<Set<string>>(new Set());
  const settings = usePreparationSettings(inspection);
  const cropPreviewBlob = useMemo(() => {
    if (settings.values.cropAppliedInEditor && editorCrop?.blob) {
      return editorCrop.blob;
    }
    return sourceFile;
  }, [settings.values.cropAppliedInEditor, editorCrop?.blob, sourceFile]);
  const cropPreviewUrl = useObjectUrl(cropPreviewBlob);
  const { setValues } = settings;
  const prepareSettingsChanged = useMemo(
    () =>
      Boolean(
        prepared &&
          valuesWhenPrepared &&
          !preparationFormValuesEqual(settings.values, valuesWhenPrepared),
      ),
    [prepared, valuesWhenPrepared, settings.values],
  );
  const supportedSavedDocuments = useMemo(
    () => savedDocuments.filter((document) => document.supported),
    [savedDocuments],
  );
  const selectedSavedDocument = useMemo(
    () =>
      savedDocuments.find(
        (document) => document.key === selectedSavedDocumentKey,
      ),
    [savedDocuments, selectedSavedDocumentKey],
  );
  const savedDocumentItems = useMemo(
    () =>
      Object.fromEntries([
        [SAVED_DOCUMENT_PLACEHOLDER, "Choose a saved document"],
        ...savedDocuments.map((document) => [
          document.key,
          `${document.label} - ${document.ref.name}${
            document.supported ? "" : " (unsupported)"
          }`,
        ]),
      ]),
    [savedDocuments],
  );

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

  useEffect(() => {
    let active = true;
    sendMessage("getMemorySnapshot", undefined)
      .then(({ items }) => {
        if (!active) return;
        const documents = items.flatMap((item) => {
          const label = fileConceptLabels.get(item.key);
          if (!label || !isFileReference(item.value)) return [];
          return [
            {
              key: item.key,
              label,
              ref: item.value,
              supported: canPrepareSavedDocument(item.value),
            },
          ];
        });
        setSavedDocuments(documents);
        if (documents.length > 0) setSourceMode("saved");
      })
      .catch(() => {
        if (active) setSavedDocuments([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      editorWatch.current?.();
      if (editorWindowRemoved.current) {
        browser.windows.onRemoved.removeListener(editorWindowRemoved.current);
        editorWindowRemoved.current = null;
      }
    },
    [],
  );

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

  const clearCurrentSource = useCallback(async () => {
    await deleteStoredRefs([
      ...(original ? [original.id] : []),
      ...(prepared ? [prepared.derived.id] : []),
      ...(editorCrop ? [editorCrop.derived.id] : []),
    ]);
  }, [deleteStoredRefs, original, prepared, editorCrop]);

  const inspectSourceFile = useCallback(
    async (file: File, ref: FileReference) => {
      const store = await storePromise;
      const registry = createBrowserFilePreparationRegistry(store);
      const adapter = registry.adapterFor(sourceInspectionFor(ref));
      if (!adapter) {
        setError(
          "This file type does not have a local preparation adapter yet.",
        );
        sound.play("filePrepareFailed");
        return;
      }
      const nextInspection = await adapter.inspect(file);
      setOriginal(ref);
      setInspection(nextInspection);
      settings.resetFor(nextInspection);
      setSourceFile(file);
      sound.play("fileSelected");
    },
    [storePromise, settings, sound],
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
          await deleteStoredRefs(editorCrop ? [editorCrop.derived.id] : []);
          storedRefIds.current.add(record.ref.id);
          const derivedFile = await store.getFile(session.derivedId);
          let derivedInspection: FileInspection = {
            kind: "image",
            name: record.ref.name,
            mimeType: record.ref.mimeType,
            sizeBytes: record.ref.sizeBytes,
          };
          if (derivedFile) {
            const registry = createBrowserFilePreparationRegistry(store);
            const adapter = registry.adapterFor(derivedInspection);
            if (adapter) {
              derivedInspection = await adapter.inspect(derivedFile);
            }
          }
          setEditorCrop({
            derived: record.ref,
            blob: record.blob,
            inspection: derivedInspection,
          });
          setValues(session.values);
          sound.play("fileEditorSaved");
        }
      } else if (session.status === "failed") {
        setError(session.reason ?? "The image editor could not finish.");
        sound.play("filePrepareFailed");
      } else if (session.status === "cancelled") {
        sound.play("fileEditorCancelled");
      }

      editorWatch.current?.();
      editorWatch.current = null;
      if (editorWindowRemoved.current) {
        browser.windows.onRemoved.removeListener(editorWindowRemoved.current);
        editorWindowRemoved.current = null;
      }
      setEditing(undefined);
      await clearEditorSession(sessionId);
    },
    [storePromise, deleteStoredRefs, editorCrop, setValues, sound],
  );
  const adoptEditorResultRef = useRef(adoptEditorResult);

  useEffect(() => {
    adoptEditorResultRef.current = adoptEditorResult;
  }, [adoptEditorResult]);

  const openEditor = async () => {
    if (!original) return;
    // A second click focuses the window that is already open rather than
    // opening a rival copy of the same edit.
    if (editing?.windowId !== undefined) {
      if (await focusPreparationEditor(editing.windowId)) {
        sound.play("fileEditorOpened");
        return;
      }
    }
    setError(undefined);
    if (prepared) {
      await deleteStoredRefs([prepared.derived.id]);
      setPrepared(undefined);
      setValuesWhenPrepared(undefined);
    }
    let opened: { sessionId: string; windowId?: number };
    try {
      opened = await openPreparationEditor({
        originalId: original.id,
        values: settings.values,
      });
      setEditing(opened);
      sound.play("fileEditorOpened");
    } catch {
      setError("The image editor could not open.");
      sound.play("filePrepareFailed");
      return;
    }

    editorWatch.current?.();
    if (editorWindowRemoved.current) {
      browser.windows.onRemoved.removeListener(editorWindowRemoved.current);
      editorWindowRemoved.current = null;
    }
    editorWatch.current = watchEditorSession(opened.sessionId, (session) => {
      if (session.status !== "open")
        void adoptEditorResultRef.current(opened.sessionId);
    });

    // The guarantee behind the editor's best-effort `pagehide` write: if the
    // window is closed with the X, the panel notices and closes the session
    // itself.
    if (opened.windowId !== undefined) {
      const onRemoved = (closedId: number) => {
        if (closedId !== opened.windowId) return;
        browser.windows.onRemoved.removeListener(onRemoved);
        editorWindowRemoved.current = null;
        void updateEditorSession(opened.sessionId, {
          status: "cancelled",
        }).then(() => adoptEditorResultRef.current(opened.sessionId));
      };
      editorWindowRemoved.current = onRemoved;
      browser.windows.onRemoved.addListener(onRemoved);
    }
  };

  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    setPrepared(undefined);
    setEditorCrop(undefined);
    await clearCurrentSource();
    setOriginal(undefined);
    setInspection(undefined);
    setSourceFile(undefined);
    try {
      const store = await storePromise;
      const ref = await store.save(file);
      storedRefIds.current.add(ref.id);
      await inspectSourceFile(file, ref);
    } catch {
      setError(
        "This file could not be inspected locally. The original was not changed.",
      );
      sound.play("filePrepareFailed");
    }
  };

  const selectSavedDocument = async (document: SavedDocument) => {
    if (!document.supported) return;
    setError(undefined);
    setPrepared(undefined);
    setEditorCrop(undefined);
    await clearCurrentSource();
    setOriginal(undefined);
    setInspection(undefined);
    setSourceFile(undefined);
    try {
      const store = await storePromise;
      const file = await store.getFile(document.ref.id);
      if (!file) {
        setError(
          "That saved document is no longer available. Add it again in My information.",
        );
        sound.play("filePrepareFailed");
        return;
      }
      await inspectSourceFile(file, document.ref);
    } catch {
      setError("That saved document could not be opened.");
      sound.play("filePrepareFailed");
    }
  };

  const pickSelectedSavedDocument = () => {
    if (!selectedSavedDocument?.supported) return;
    void selectSavedDocument(selectedSavedDocument);
  };

  const chooseSourceMode = (nextMode: SourceMode) => {
    if (nextMode === sourceMode) return;
    setSourceMode(nextMode);
    sound.play("fileSourceSelected");
  };

  const chooseSavedDocument = (key: string | null) => {
    const nextKey = key ?? SAVED_DOCUMENT_PLACEHOLDER;
    if (nextKey === selectedSavedDocumentKey) return;
    setSelectedSavedDocumentKey(nextKey);
    if (nextKey !== SAVED_DOCUMENT_PLACEHOLDER)
      sound.play("fileSourceSelected");
  };

  const prepare = async () => {
    if (!original || !inspection || !settings.spec) return;
    setBusy(true);
    setError(undefined);
    sound.startLoop("file-prepare", "filePrepareStarted");
    let outcome: "filePrepareSucceeded" | "filePrepareFailed" | undefined;
    try {
      const store = await storePromise;
      const registry = createBrowserFilePreparationRegistry(store);
      const adapter = registry.adapterFor(inspection);
      if (!adapter) {
        setError(
          "This file type does not have a local preparation adapter yet.",
        );
        outcome = "filePrepareFailed";
        return;
      }
      const resolved = resolvePrepareInput({
        original,
        editorCropDerived: editorCrop?.derived,
        prepared,
        values: settings.values,
        spec: settings.spec,
      });
      if (resolved.error) {
        setError(resolved.error);
        outcome = "filePrepareFailed";
        return;
      }
      const result = await adapter.prepare(resolved.input, resolved.spec);
      if (!result.ok) {
        setError(result.reason);
        outcome = "filePrepareFailed";
        return;
      }
      await deleteStoredRefs([
        ...(prepared ? [prepared.derived.id] : []),
        ...(editorCrop ? [editorCrop.derived.id] : []),
      ]);
      storedRefIds.current.add(result.artifact.derived.id);
      setEditorCrop(undefined);
      setPrepared({
        ...result.artifact,
        original,
      });
      setValuesWhenPrepared(snapshotPreparationFormValues(settings.values));
      outcome = "filePrepareSucceeded";
    } catch {
      setError("Local preparation failed. The original file was not changed.");
      outcome = "filePrepareFailed";
    } finally {
      sound.stopLoop("file-prepare");
      if (outcome) sound.play(outcome);
      setBusy(false);
    }
  };

  const reset = () => {
    void clearCurrentSource();
    setOriginal(undefined);
    setInspection(undefined);
    setPrepared(undefined);
    setEditorCrop(undefined);
    setValuesWhenPrepared(undefined);
    setSourceFile(undefined);
    setError(undefined);
    settings.resetFor(undefined);
  };

  const showCropHint =
    settings.values.cropAppliedInEditor && !editorCrop && !prepared;
  const showPrepareAction = busy || !prepared || prepareSettingsChanged;
  const prepareStepFooter =
    !showCropHint && !showPrepareAction ? undefined : (
      <>
        {showCropHint && (
          <p className="text-muted-foreground text-xs">
            Open the editor and apply crop before preparing again.
          </p>
        )}
        {showPrepareAction && (
          <>
            <Button
              type="button"
              disabled={
                busy ||
                (settings.values.cropAppliedInEditor === true &&
                  !editorCrop &&
                  !prepared)
              }
              onClick={() => void prepare()}
            >
              {busy ? (
                <>
                  <LoaderCircle className="animate-spin" /> Preparing...
                </>
              ) : prepareSettingsChanged ? (
                "Prepare Temporary copy with new settings"
              ) : (
                "Prepare temporary copy"
              )}
            </Button>
            <p className="text-center text-muted-foreground text-xs">
              {prepareSettingsChanged
                ? "Form settings changed. Prepare again to replace the upload copy."
                : "Creates a temporary upload copy. Your original file stays unchanged."}
            </p>
          </>
        )}
      </>
    );

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
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={sourceMode === "saved" ? "default" : "outline"}
                className="h-auto min-h-14 flex-col items-start gap-0.5 px-3 py-2 text-left"
                disabled={savedDocuments.length === 0}
                onClick={() => chooseSourceMode("saved")}
              >
                <span className="font-semibold text-sm">Use a saved file</span>
                <span className="font-normal text-xs opacity-80">
                  From My information
                </span>
              </Button>
              <Button
                type="button"
                variant={sourceMode === "upload" ? "default" : "outline"}
                className="h-auto min-h-14 flex-col items-start gap-0.5 px-3 py-2 text-left"
                onClick={() => chooseSourceMode("upload")}
              >
                <span className="font-semibold text-sm">Choose a new file</span>
                <span className="font-normal text-xs opacity-80">
                  From this computer
                </span>
              </Button>
            </div>

            {sourceMode === "saved" ? (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-2.5">
                {savedDocuments.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-2 text-muted-foreground text-xs">
                    Saved resumes, photos, and signatures will appear here after
                    you add them in My information.
                  </p>
                ) : (
                  <>
                    <div className="flex items-end gap-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
                        <label
                          htmlFor="saved-document"
                          className="text-muted-foreground"
                        >
                          Pick a saved file
                        </label>
                        <Select
                          value={selectedSavedDocumentKey}
                          onValueChange={chooseSavedDocument}
                          items={savedDocumentItems}
                        >
                          <SelectTrigger id="saved-document">
                            {selectedSavedDocument ? (
                              <span className="min-w-0 truncate text-left">
                                <span>{selectedSavedDocument.label}</span>{" "}
                                <span className="ml-1.5 text-muted-foreground italic">
                                  {selectedSavedDocument.ref.name}
                                </span>
                              </span>
                            ) : (
                              <SelectValue />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              value={SAVED_DOCUMENT_PLACEHOLDER}
                              disabled
                            >
                              Choose a saved document
                            </SelectItem>
                            {savedDocuments.map((document) => (
                              <SelectItem
                                key={document.key}
                                value={document.key}
                                disabled={!document.supported}
                              >
                                <span>{document.label}</span>
                                <span className="ml-1.5 min-w-0 truncate text-muted-foreground italic">
                                  {document.ref.name}
                                </span>
                                {!document.supported && (
                                  <span className="text-muted-foreground">
                                    unsupported
                                  </span>
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0 font-normal"
                        disabled={!selectedSavedDocument?.supported}
                        onClick={pickSelectedSavedDocument}
                      >
                        <FileCheck2 className="size-4" />
                        Use this
                      </Button>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {selectedSavedDocument
                        ? formatBytes(selectedSavedDocument.ref.sizeBytes)
                        : `${supportedSavedDocuments.length} saved ${
                            supportedSavedDocuments.length === 1
                              ? "file"
                              : "files"
                          } ready`}
                      {savedDocuments.some((document) => !document.supported)
                        ? ". Images and PDFs can be prepared here."
                        : ""}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <label
                className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/30 p-3 text-center hover:border-primary/60"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void selectFile(event.dataTransfer.files[0]);
                }}
              >
                <FileUp className="size-5 text-muted-foreground" />
                <span className="font-medium text-sm">
                  Choose or drop a new file
                </span>
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
          </>
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
          <div className={prepareStepPanelClass}>
            <PrepareStepHeading step={1} title="Your file" />
            <PrepareStepBody className="flex items-start justify-between gap-3">
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
            </PrepareStepBody>
          </div>

          {cropPreviewUrl && inspection.kind === "image" && (
            <div className={prepareStepPanelClass}>
              <PrepareStepHeading
                step={2}
                title={
                  <>
                    Crop{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </>
                }
              />
              <PrepareStepBody className="flex items-center gap-3">
                <img
                  src={cropPreviewUrl}
                  alt=""
                  className="size-16 shrink-0 rounded object-contain"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-muted-foreground text-xs">
                    {settings.values.cropAppliedInEditor
                      ? "Using cropped image"
                      : settings.values.crop
                        ? `Cropped to ${Math.round(settings.values.crop.width)} × ${Math.round(settings.values.crop.height)} px`
                        : "Using the full photo"}
                  </p>
                  <EditImageGuidanceTooltip />
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
              </PrepareStepBody>
            </div>
          )}

          <PreparationSettings
            inspection={inspection}
            settings={settings}
            footer={prepareStepFooter}
          />
          {error && <p className="text-destructive text-xs">{error}</p>}
        </section>
      )}

      {prepared && store && (
        <>
          <PreparedFileHandoff
            artifact={prepared}
            store={store}
            // The preset names the preview for screen readers. Custom names
            // nothing, so fall back to the generic noun.
            label={
              settings.values.presetId === CUSTOM_PRESET_ID
                ? undefined
                : presetById(settings.values.presetId)?.label.toLowerCase()
            }
          />
          {prepared.mimeType.startsWith("image/") ? (
            <PreparationSuccessSupport />
          ) : null}
        </>
      )}
    </div>
  );
};
