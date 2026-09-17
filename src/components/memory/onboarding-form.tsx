import { AlertCircle, Check, FileUp, Loader2, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { type FileReference, isFileReference } from "~/core/memory/types";
import { concepts } from "~/core/ontology";
import { Sensitivity } from "~/core/ontology/types";
import { createIndexedDbFileReferenceStore } from "~/lib/files/adapters";
import { sendMessage } from "~/lib/messaging";
import { useSound } from "~/lib/sfx/react";
import { LocalDataControls } from "./local-data-controls";

/**
 * An ontology-driven "tell us about yourself" form.
 *
 * ADR 005: values are typed once. For a new user, memory is empty, every
 * field the matcher resolves becomes a question, and the extension is
 * worse than typing the form by hand — onboarding is what makes the first
 * real fill possible at all.
 *
 * **Driven from `concepts.json`, not hand-written.** Adding a concept in
 * phase 1b adds a field here with no code change: the mapping from a
 * concept's `expects` to an `<Input type>` is the only place presentation
 * is decided, so replacing the look later is replacing that one mapping,
 * not rewriting a form. File uploads are out of scope for this phase (see
 * the brief's "Out of scope"), so `expects: "file"` concepts are excluded.
 *
 * {@link Sensitivity.RESTRICTED} concepts are grouped into their own
 * section, presented last and marked with a lock icon — "respect
 * sensitivity in how prominently a field is presented" from the brief.
 */

const EXPECTS_TO_INPUT_TYPE: Record<string, string> = {
  email: "email",
  tel: "tel",
  url: "url",
  number: "number",
  date: "date",
};

const inputTypeFor = (expects: string): string =>
  EXPECTS_TO_INPUT_TYPE[expects] ?? "text";

const groupLabel = (key: string): string => {
  const [prefix] = key.split(".");
  if (!prefix) return "Other";
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
};

const fileConcepts = concepts.filter((c) => c.expects === "file");
const fillableConcepts = concepts.filter((c) => c.expects !== "file");
const standardConcepts = fillableConcepts.filter(
  (c) => c.sensitivity !== Sensitivity.RESTRICTED,
);
const restrictedConcepts = fillableConcepts.filter(
  (c) => c.sensitivity === Sensitivity.RESTRICTED,
);

const AUTOSAVE_DELAY_MS = 600;

type FieldStatus = "idle" | "pending" | "saving" | "saved" | "error";

const groupByPrefix = <T extends { key: string }>(
  items: readonly T[],
): [string, T[]][] => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const label = groupLabel(item.key);
    const list = groups.get(label) ?? [];
    list.push(item);
    groups.set(label, list);
  }
  return Array.from(groups.entries());
};

export const OnboardingForm = () => {
  const sound = useSound();
  const [values, setValues] = useState<Record<string, string>>({});
  const [fileRefs, setFileRefs] = useState<Record<string, FileReference>>({});
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [fieldStatuses, setFieldStatuses] = useState<
    Record<string, FieldStatus>
  >({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveVersions = useRef<Record<string, number>>({});

  const loadSnapshot = () => {
    sendMessage("getMemorySnapshot", undefined).then(({ items }) => {
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
    });
  };

  useEffect(loadSnapshot, []);

  useEffect(
    () => () => {
      for (const timer of Object.values(saveTimers.current)) {
        clearTimeout(timer);
      }
    },
    [],
  );

  const groupedStandard = useMemo(() => groupByPrefix(standardConcepts), []);

  const setFieldStatus = (key: string, status: FieldStatus) => {
    setFieldStatuses((prev) => ({ ...prev, [key]: status }));
  };

  const recordField = async (
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
  };

  const scheduleTextSave = (key: string, value: string, label: string) => {
    const nextVersion = (saveVersions.current[key] ?? 0) + 1;
    saveVersions.current[key] = nextVersion;
    clearTimeout(saveTimers.current[key]);

    if (value.trim() === "") {
      setFieldStatus(key, "idle");
      return;
    }

    setFieldStatus(key, "pending");
    saveTimers.current[key] = setTimeout(() => {
      void recordField(key, value, label, nextVersion);
    }, AUTOSAVE_DELAY_MS);
  };

  const tagFile = async (
    key: string,
    label: string,
    file: File | undefined,
  ) => {
    if (!file) return;
    const nextVersion = (saveVersions.current[key] ?? 0) + 1;
    saveVersions.current[key] = nextVersion;
    clearTimeout(saveTimers.current[key]);
    setFieldStatus(key, "saving");
    sound.startLoop(`file-tagging:${key}`, "fileTagging");
    let saved = false;

    try {
      const store = await createIndexedDbFileReferenceStore();
      const ref = await store.save(file);
      setFileRefs((prev) => ({ ...prev, [key]: ref }));
      saved = await recordField(key, ref, label, nextVersion, false);
    } catch {
      if (saveVersions.current[key] === nextVersion) {
        setFieldStatus(key, "error");
      }
    } finally {
      sound.stopLoop(`file-tagging:${key}`);
    }
    sound.play(saved ? "onboardingSaveSucceeded" : "onboardingSaveFailed");
  };

  const renderStatus = (key: string) => {
    const status = fieldStatuses[key] ?? "idle";
    if (status === "idle") return null;

    const statusLabels: Record<Exclude<FieldStatus, "idle">, string> = {
      pending: "Waiting to save",
      saving: "Saving",
      saved: "Saved",
      error: "Save failed",
    };

    return (
      <span
        aria-label={statusLabels[status]}
        className="pointer-events-none absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-muted-foreground"
        data-testid={`autosave-status-${key}`}
        role="img"
      >
        {status === "pending" || status === "saving" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : status === "saved" ? (
          <Check className="size-3.5 text-primary" />
        ) : (
          <AlertCircle className="size-3.5 text-destructive" />
        )}
      </span>
    );
  };

  const renderTextField = (concept: (typeof fillableConcepts)[number]) => {
    return (
      <div key={concept.key} className="flex flex-col gap-1">
        <Label htmlFor={concept.key}>{concept.label}</Label>
        <div className="relative">
          <Input
            className="pr-9"
            id={concept.key}
            type={inputTypeFor(concept.expects)}
            value={values[concept.key] ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              sound.play("onboardingTyping");
              setValues((prev) => ({
                ...prev,
                [concept.key]: value,
              }));
              scheduleTextSave(concept.key, value, concept.label);
            }}
          />
          {renderStatus(concept.key)}
        </div>
      </div>
    );
  };

  return (
    <form
      className="flex w-full flex-col gap-5"
      onSubmit={(event) => event.preventDefault()}
    >
      {groupedStandard.map(([group, items]) => (
        <fieldset
          key={group}
          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/5 dark:shadow-black/20"
        >
          <legend className="px-1 font-semibold text-sm text-foreground">
            {group}
          </legend>
          {items.map(renderTextField)}
        </fieldset>
      ))}

      <fieldset className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <legend className="flex items-center gap-1.5 font-semibold text-sm">
          <Lock className="size-3.5" />
          Sensitive information
        </legend>
        <p className="text-muted-foreground text-xs">
          Government IDs, financial and health details. These are only ever
          filled after you explicitly confirm each one.
        </p>
        {restrictedConcepts.map(renderTextField)}
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
        <legend className="flex items-center gap-1.5 font-semibold text-sm">
          <FileUp className="size-3.5" />
          Files
        </legend>
        {fileConcepts.map((concept) => {
          const ref = fileRefs[concept.key];
          return (
            <div key={concept.key} className="flex flex-col gap-1">
              <Label htmlFor={concept.key}>{concept.label}</Label>
              <div className="relative">
                <Input
                  className="pr-9"
                  id={concept.key}
                  type="file"
                  onChange={(e) =>
                    tagFile(concept.key, concept.label, e.target.files?.[0])
                  }
                />
                {renderStatus(concept.key)}
              </div>
              {ref && (
                <p className="text-muted-foreground text-xs">
                  {ref.name} · {Math.round(ref.sizeBytes / 1024)} KB
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      <p className="text-muted-foreground text-xs" data-testid="saved-count">
        {savedKeys.size} value{savedKeys.size === 1 ? "" : "s"} saved
      </p>
      <LocalDataControls onDataChanged={loadSnapshot} />
    </form>
  );
};
