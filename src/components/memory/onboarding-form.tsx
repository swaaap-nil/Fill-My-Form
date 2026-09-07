import { FileUp, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { type FileReference, isFileReference } from "~/core/memory/types";
import { concepts } from "~/core/ontology";
import { Sensitivity } from "~/core/ontology/types";
import { createIndexedDbFileReferenceStore } from "~/lib/files/adapters";
import { sendMessage } from "~/lib/messaging";
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
  const [values, setValues] = useState<Record<string, string>>({});
  const [fileRefs, setFileRefs] = useState<Record<string, FileReference>>({});
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

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
    });
  };

  useEffect(loadSnapshot, []);

  const groupedStandard = useMemo(() => groupByPrefix(standardConcepts), []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);

    const entries = Object.entries(values).filter(([, v]) => v.trim() !== "");
    const fileEntries = Object.entries(fileRefs);
    await Promise.all([
      ...entries.map(([key, value]) => {
        const concept = fillableConcepts.find((c) => c.key === key);
        return sendMessage("recordOnboardingAnswer", {
          key,
          value,
          label: concept?.label,
        });
      }),
      ...fileEntries.map(([key, value]) => {
        const concept = fileConcepts.find((c) => c.key === key);
        return sendMessage("recordOnboardingAnswer", {
          key,
          value,
          label: concept?.label,
        });
      }),
    ]);

    setSavedKeys(new Set([...entries, ...fileEntries].map(([key]) => key)));
    setSaving(false);
  };

  const tagFile = async (key: string, file: File | undefined) => {
    if (!file) return;
    const store = await createIndexedDbFileReferenceStore();
    const ref = await store.save(file);
    setFileRefs((prev) => ({ ...prev, [key]: ref }));
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
      {groupedStandard.map(([group, items]) => (
        <fieldset
          key={group}
          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/5 dark:shadow-black/20"
        >
          <legend className="px-1 font-semibold text-sm text-foreground">
            {group}
          </legend>
          {items.map((concept) => (
            <div key={concept.key} className="flex flex-col gap-1">
              <Label htmlFor={concept.key}>{concept.label}</Label>
              <Input
                id={concept.key}
                type={inputTypeFor(concept.expects)}
                value={values[concept.key] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [concept.key]: e.target.value,
                  }))
                }
              />
            </div>
          ))}
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
        {restrictedConcepts.map((concept) => (
          <div key={concept.key} className="flex flex-col gap-1">
            <Label htmlFor={concept.key}>{concept.label}</Label>
            <Input
              id={concept.key}
              type={inputTypeFor(concept.expects)}
              value={values[concept.key] ?? ""}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [concept.key]: e.target.value,
                }))
              }
            />
          </div>
        ))}
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
              <Input
                id={concept.key}
                type="file"
                onChange={(e) => tagFile(concept.key, e.target.files?.[0])}
              />
              {ref && (
                <p className="text-muted-foreground text-xs">
                  {ref.name} · {Math.round(ref.sizeBytes / 1024)} KB
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
      <p className="text-muted-foreground text-xs" data-testid="saved-count">
        {savedKeys.size} value{savedKeys.size === 1 ? "" : "s"} saved
      </p>
      <LocalDataControls onDataChanged={loadSnapshot} />
    </form>
  );
};
