import { useCallback, useEffect, useRef, useState } from "react";
import { type FileReference, isFileReference } from "~/core/memory/types";
import { createIndexedDbFileReferenceStore } from "~/lib/files/adapters";
import { sendMessage } from "~/lib/messaging";
import { useSound } from "~/lib/sfx/react";

// Keeps onboarding persistence out of the form component.
// This hook owns memory snapshots, debounced text saves, file tagging, status
// updates, and save-result sounds; the component only renders fields.

const AUTOSAVE_DELAY_MS = 600;

export type FieldStatus = "idle" | "pending" | "saving" | "saved" | "error";

export const useOnboardingMemory = () => {
  const sound = useSound();
  const [values, setValues] = useState<Record<string, string>>({});
  const [fileRefs, setFileRefs] = useState<Record<string, FileReference>>({});
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [fieldStatuses, setFieldStatuses] = useState<
    Record<string, FieldStatus>
  >({});
  const loadVersion = useRef(0);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveVersions = useRef<Record<string, number>>({});

  const setFieldStatus = useCallback((key: string, status: FieldStatus) => {
    setFieldStatuses((prev) => ({ ...prev, [key]: status }));
  }, []);

  const loadSnapshot = useCallback(() => {
    loadVersion.current += 1;
    const version = loadVersion.current;
    sendMessage("getMemorySnapshot", undefined)
      .then(({ items }) => {
        if (loadVersion.current !== version) return;

        const loaded: Record<string, string> = {};
        const loadedFiles: Record<string, FileReference> = {};
        for (const item of items) {
          if (typeof item.value === "string") loaded[item.key] = item.value;
          if (isFileReference(item.value)) loadedFiles[item.key] = item.value;
        }
        setValues(loaded);
        setFileRefs(loadedFiles);
        setSavedKeys(new Set(items.map((i) => i.key)));
        setFieldStatuses({});
      })
      .catch(() => {
        setFieldStatuses({});
      });
  }, []);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  useEffect(
    () => () => {
      loadVersion.current += 1;
      for (const timer of Object.values(saveTimers.current)) {
        clearTimeout(timer);
      }
    },
    [],
  );

  const recordField = useCallback(
    async (
      key: string,
      value: string | FileReference,
      label: string,
      version: number,
      playOutcome = true,
    ): Promise<boolean> => {
      setFieldStatus(key, "saving");
      try {
        await sendMessage("recordOnboardingAnswer", { key, value, label });
        if (saveVersions.current[key] !== version) return false;
        setSavedKeys((prev) => new Set(prev).add(key));
        setFieldStatus(key, "saved");
        if (playOutcome) sound.play("onboardingSaveSucceeded");
        return true;
      } catch {
        if (saveVersions.current[key] === version) {
          setFieldStatus(key, "error");
          if (playOutcome) sound.play("onboardingSaveFailed");
        }
        return false;
      }
    },
    [setFieldStatus, sound],
  );

  const deleteField = useCallback(
    async (key: string, version: number): Promise<boolean> => {
      setFieldStatus(key, "saving");
      try {
        await sendMessage("deleteOnboardingAnswer", { key });
        const { items } = await sendMessage("getMemorySnapshot", undefined);
        const deleted = !items.some((item) => item.key === key);
        if (!deleted)
          throw new Error("Deleted onboarding answer still exists.");
        if (saveVersions.current[key] !== version) return false;
        setSavedKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setFieldStatus(key, "saved");
        sound.play("onboardingSaveSucceeded");
        return true;
      } catch {
        if (saveVersions.current[key] === version) {
          setFieldStatus(key, "error");
          sound.play("onboardingSaveFailed");
        }
        return false;
      }
    },
    [setFieldStatus, sound],
  );

  const scheduleTextSave = useCallback(
    (key: string, value: string, label: string) => {
      const nextVersion = (saveVersions.current[key] ?? 0) + 1;
      saveVersions.current[key] = nextVersion;
      clearTimeout(saveTimers.current[key]);

      if (value.trim() === "") {
        if (!savedKeys.has(key)) {
          setFieldStatus(key, "idle");
          return;
        }
        setFieldStatus(key, "pending");
        saveTimers.current[key] = setTimeout(() => {
          void deleteField(key, nextVersion);
        }, AUTOSAVE_DELAY_MS);
        return;
      }

      setFieldStatus(key, "pending");
      saveTimers.current[key] = setTimeout(() => {
        void recordField(key, value, label, nextVersion);
      }, AUTOSAVE_DELAY_MS);
    },
    [deleteField, recordField, savedKeys, setFieldStatus],
  );

  const updateTextField = useCallback(
    (key: string, value: string, label: string) => {
      sound.play("onboardingTyping");
      setValues((prev) => ({
        ...prev,
        [key]: value,
      }));
      scheduleTextSave(key, value, label);
    },
    [scheduleTextSave, sound],
  );

  const updateFileField = useCallback(
    async (key: string, label: string, file: File | undefined) => {
      if (!file) return;
      const nextVersion = (saveVersions.current[key] ?? 0) + 1;
      saveVersions.current[key] = nextVersion;
      clearTimeout(saveTimers.current[key]);
      setFieldStatus(key, "saving");
      sound.startLoop(`file-tagging:${key}`, "fileTagging");
      let saved = false;
      let ref: FileReference | undefined;

      try {
        const store = await createIndexedDbFileReferenceStore();
        ref = await store.save(file);
        saved = await recordField(key, ref, label, nextVersion, false);
        if (saved && ref && saveVersions.current[key] === nextVersion) {
          const savedRef = ref;
          setFileRefs((prev) => ({ ...prev, [key]: savedRef }));
        }
      } catch {
        if (ref) {
          const failedRef = ref;
          void createIndexedDbFileReferenceStore().then((store) =>
            store.delete(failedRef.id),
          );
        }
        if (saveVersions.current[key] === nextVersion) {
          setFieldStatus(key, "error");
        }
      } finally {
        sound.stopLoop(`file-tagging:${key}`);
      }
      sound.play(saved ? "onboardingSaveSucceeded" : "onboardingSaveFailed");
    },
    [recordField, setFieldStatus, sound],
  );

  const getStatus = useCallback(
    (key: string): FieldStatus => fieldStatuses[key] ?? "idle",
    [fieldStatuses],
  );

  return {
    fileRefs,
    getStatus,
    reload: loadSnapshot,
    savedCount: savedKeys.size,
    updateFileField,
    updateTextField,
    values,
  };
};
