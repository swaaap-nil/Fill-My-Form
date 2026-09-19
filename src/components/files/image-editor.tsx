import {
  FlipHorizontal,
  FlipVertical,
  LoaderCircle,
  Maximize,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SelectField } from "~/components/ui/select";
import { formatBytes } from "~/core/files/byte-units";
import type { EditorSession } from "~/core/files/editor-session";
import type { CropRect, FileInspection } from "~/core/files/preparation";
import { resolveLockedRatio } from "~/core/files/preparation-form";
import {
  createIndexedDbFileReferenceStore,
  type FileReferenceStore,
} from "~/lib/files/adapters";
import {
  loadEditorSession,
  updateEditorSession,
} from "~/lib/files/editor-session";
import { ImagePreparationAdapter } from "~/lib/files/image-preparation-adapter";
import { CropStage, type CropStageHandle } from "./crop-stage";
import { FileMetadataCards } from "./file-metadata-cards";
import { useObjectUrl } from "./use-object-url";
import { usePreparationSettings } from "./use-preparation-settings";

type Phase = "loading" | "ready" | "saving" | "done" | "error";

const CROP_RATIO_OPTIONS = [
  { value: "original", label: "Original" },
  { value: "free", label: "Free" },
  { value: "1:1", label: "1:1 square" },
  { value: "4:5", label: "4:5 portrait" },
  { value: "3:4", label: "3:4 portrait" },
  { value: "2:3", label: "2:3 portrait" },
  { value: "16:9", label: "16:9 landscape" },
  { value: "9:16", label: "9:16 vertical" },
  { value: "custom", label: "Custom" },
] as const;

/**
 * The editor window focuses on crop geometry and transforms. Final output
 * settings stay in the side panel, but the chosen values are still carried
 * through here so applying a crop can render the prepared copy at the intended
 * size and format.
 */
export const ImageEditor = ({ sessionId }: { readonly sessionId: string }) => {
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string>();
  const [session, setSession] = useState<EditorSession>();
  const [store, setStore] = useState<FileReferenceStore>();
  const [inspection, setInspection] = useState<FileInspection>();
  const [sourceFile, setSourceFile] = useState<File>();
  const [crop, setCrop] = useState<CropRect>();
  const stageRef = useRef<CropStageHandle | null>(null);
  const sourceUrl = useObjectUrl(sourceFile);

  const settings = usePreparationSettings(inspection);
  const { setValues } = settings;
  const originalCropRatioInput =
    inspection?.width && inspection.height
      ? `${inspection.width}:${inspection.height}`
      : "";

  const selectedCropRatio = useMemo(() => {
    if (!settings.values.lockAspect) return "free";
    if (
      originalCropRatioInput &&
      settings.values.aspectRatioInput === originalCropRatioInput
    ) {
      return "original";
    }
    return CROP_RATIO_OPTIONS.some(
      (option) => option.value === settings.values.aspectRatioInput,
    )
      ? settings.values.aspectRatioInput
      : "custom";
  }, [
    originalCropRatioInput,
    settings.values.aspectRatioInput,
    settings.values.lockAspect,
  ]);

  const lockedRatio = useMemo(
    () =>
      settings.values.lockAspect
        ? resolveLockedRatio(settings.values)
        : undefined,
    [settings.values],
  );

  const setCropRatio = useCallback(
    (next: string) => {
      setValues((current) => {
        if (next === "free") {
          return { ...current, lockAspect: false, aspectRatioInput: "" };
        }
        if (next === "original") {
          return {
            ...current,
            lockAspect: Boolean(originalCropRatioInput),
            aspectRatioInput: originalCropRatioInput,
          };
        }
        if (next === "custom") {
          return { ...current, lockAspect: true };
        }
        return { ...current, lockAspect: true, aspectRatioInput: next };
      });
    },
    [originalCropRatioInput, setValues],
  );

  const setCustomCropRatio = useCallback(
    (next: string) => {
      setValues((current) => ({
        ...current,
        lockAspect: true,
        aspectRatioInput: next,
      }));
    },
    [setValues],
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const nextSession = await loadEditorSession(sessionId);
        if (!nextSession) {
          setPhase("error");
          setMessage(
            "This editing session has expired. Close this window and start again from the panel.",
          );
          return;
        }
        const nextStore = await createIndexedDbFileReferenceStore();
        const file = await nextStore.getFile(nextSession.originalId);
        if (!file) {
          setPhase("error");
          setMessage("The original file is no longer available.");
          return;
        }
        const adapter = new ImagePreparationAdapter(nextStore);
        const nextInspection = await adapter.inspect(file);
        if (!active) return;
        setSession(nextSession);
        setStore(nextStore);
        setInspection(nextInspection);
        // Carry the panel's settings across, so the editor opens where the
        // user left off rather than resetting their work.
        setValues(nextSession.values);
        setSourceFile(file);
        setPhase("ready");
      } catch {
        if (!active) return;
        setPhase("error");
        setMessage("This image could not be opened for editing.");
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [sessionId, setValues]);

  /**
   * Best-effort: if the window is closed with the X rather than a button, tell
   * the panel. The write is async and may not land, which is why the panel
   * also watches `windows.onRemoved` — this is the optimisation, not the
   * guarantee.
   */
  useEffect(() => {
    const handle = () => {
      if (phase === "done" || phase === "saving") return;
      void updateEditorSession(sessionId, { status: "cancelled" });
    };
    window.addEventListener("pagehide", handle);
    return () => window.removeEventListener("pagehide", handle);
  }, [sessionId, phase]);

  const onReady = useCallback((handle: CropStageHandle) => {
    stageRef.current = handle;
    setCrop(handle.getSelection());
  }, []);

  const onSelectionChange = useCallback((rect: CropRect) => {
    setCrop(rect);
  }, []);

  const save = async () => {
    const handle = stageRef.current;
    // Never fail silently here. A primary button that does nothing and says
    // nothing is the worst outcome, and it is what an early `return` gives.
    if (!handle) {
      setPhase("error");
      setMessage("The image is still loading. Try again in a moment.");
      return;
    }
    if (!store || !session || !settings.spec) {
      setPhase("error");
      setMessage("This editing session is no longer available.");
      return;
    }
    setPhase("saving");
    setMessage(undefined);
    try {
      const original = await store.get(session.originalId);
      if (!original) {
        setPhase("error");
        setMessage("The original file is no longer available.");
        return;
      }
      const canvas = await handle.toCanvas(
        settings.pixelSize.width && settings.pixelSize.height
          ? {
              width: settings.pixelSize.width,
              height: settings.pixelSize.height,
            }
          : undefined,
      );
      if (!canvas) {
        setPhase("error");
        setMessage("The crop could not be rendered.");
        return;
      }
      const adapter = new ImagePreparationAdapter(store);
      // The canvas already carries the crop, rotation and flips, so the spec
      // must not apply them a second time.
      const result = await adapter.prepareFromCanvas(
        original.ref,
        canvas,
        { ...settings.spec, crop: undefined },
        [`Cropped to ${canvas.width}×${canvas.height}px in the editor`],
      );
      if (!result.ok) {
        setPhase("error");
        setMessage(result.reason);
        return;
      }
      await updateEditorSession(sessionId, {
        status: "saved",
        derivedId: result.artifact.derived.id,
        values: { ...settings.values, crop: handle.getSelection() },
      });
      setPhase("done");
      setMessage(
        `Saved ${result.artifact.name} · ${formatBytes(result.artifact.sizeBytes)}`,
      );
      window.close();
    } catch {
      setPhase("error");
      setMessage("The prepared copy could not be created.");
    }
  };

  const cancel = async () => {
    await updateEditorSession(sessionId, { status: "cancelled" });
    setPhase("done");
    window.close();
  };

  if (phase === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center gap-2 text-muted-foreground text-sm">
        <LoaderCircle className="size-4 animate-spin" /> Opening image...
      </div>
    );
  }

  if (!inspection || !sourceUrl) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-destructive text-sm">
          {message ?? "This image could not be opened for editing."}
        </p>
        <Button type="button" variant="outline" onClick={() => window.close()}>
          Close
        </Button>
      </div>
    );
  }

  const setCropField = (key: keyof CropRect, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    stageRef.current?.setSelection({ [key]: value });
    setCrop(stageRef.current?.getSelection());
  };

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-0 flex-1 bg-muted/40">
          <CropStage
            src={sourceUrl}
            aspectRatio={lockedRatio}
            onReady={onReady}
            onSelectionChange={onSelectionChange}
          />
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-border border-t bg-card p-4 lg:w-80 lg:border-t-0 lg:border-l">
          <div className="min-w-0 rounded-md border border-primary/20 bg-primary/5 p-3">
            <FileMetadataCards inspection={inspection} />
            <p className="mt-2 truncate text-muted-foreground text-xs">
              {inspection.name}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="font-medium text-foreground text-xs">Crop box</p>
            <p className="text-muted-foreground text-xs">
              Choose the shape the form needs, then drag the box over the part
              to keep.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                id="crop-ratio"
                label="Crop ratio"
                value={selectedCropRatio}
                onValueChange={setCropRatio}
                options={CROP_RATIO_OPTIONS}
                className={
                  selectedCropRatio === "custom" ? undefined : "col-span-2"
                }
              />
              {selectedCropRatio === "custom" && (
                <label
                  htmlFor="crop-ratio-custom"
                  className="flex min-w-0 flex-col gap-1 text-xs"
                >
                  <span className="text-muted-foreground">Custom ratio</span>
                  <Input
                    id="crop-ratio-custom"
                    placeholder="4:5"
                    value={settings.values.aspectRatioInput}
                    onChange={(event) => setCustomCropRatio(event.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "width", "height"] as const).map((key) => (
                <label
                  key={key}
                  htmlFor={`crop-${key}`}
                  className="flex min-w-0 flex-col gap-1 text-xs"
                >
                  <span className="text-muted-foreground capitalize">
                    {key}
                  </span>
                  <Input
                    id={`crop-${key}`}
                    type="number"
                    inputMode="numeric"
                    value={crop ? `${Math.round(crop[key])}` : ""}
                    onChange={(event) => setCropField(key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Rotate left"
              onClick={() => stageRef.current?.rotate(-90)}
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Rotate right"
              onClick={() => stageRef.current?.rotate(90)}
            >
              <RotateCw className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Flip horizontally"
              onClick={() => stageRef.current?.scale(-1, 1)}
            >
              <FlipHorizontal className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Flip vertically"
              onClick={() => stageRef.current?.scale(1, -1)}
            >
              <FlipVertical className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Zoom in"
              onClick={() => stageRef.current?.zoom(0.1)}
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Zoom out"
              onClick={() => stageRef.current?.zoom(-0.1)}
            >
              <ZoomOut className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Fit to window"
              onClick={() => stageRef.current?.fit()}
            >
              <Maximize className="size-4" />
            </Button>
          </div>
        </aside>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-border border-t bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          {message && (
            <p
              className={
                phase === "error"
                  ? "text-destructive text-xs"
                  : "text-muted-foreground text-xs"
              }
            >
              {message}
            </p>
          )}
        </div>
        {/* Reset is a quiet text button: it undoes work but destroys nothing,
            so the destructive styling the reference used would overstate it. */}
        <Button
          type="button"
          variant="ghost"
          onClick={() => stageRef.current?.reset()}
        >
          Reset
        </Button>
        <Button type="button" variant="outline" onClick={() => void cancel()}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={phase === "saving"}
          onClick={() => void save()}
        >
          {phase === "saving" ? (
            <>
              <LoaderCircle className="animate-spin" /> Saving...
            </>
          ) : (
            "Apply crop"
          )}
        </Button>
      </footer>
    </div>
  );
};
