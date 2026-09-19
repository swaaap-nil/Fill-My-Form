import { AlertCircle, Check, FileUp, Loader2, Lock } from "lucide-react";
import { useMemo } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { concepts } from "~/core/ontology";
import { Sensitivity } from "~/core/ontology/types";
import { LocalDataControls } from "./local-data-controls";
import { type FieldStatus, useOnboardingMemory } from "./use-onboarding-memory";

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
  const {
    fileRefs,
    getStatus,
    reload,
    savedCount,
    updateFileField,
    updateTextField,
    values,
  } = useOnboardingMemory();
  const groupedStandard = useMemo(() => groupByPrefix(standardConcepts), []);

  const renderStatus = (key: string) => {
    const status = getStatus(key);
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
              updateTextField(concept.key, value, concept.label);
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
      <p className="rounded-lg border border-border bg-card p-3 text-muted-foreground text-sm shadow-sm shadow-black/5 dark:shadow-black/20">
        You do not need to add everything here. Start on any form and Fill My
        Form will ask only what it needs.
      </p>

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
                    updateFileField(
                      concept.key,
                      concept.label,
                      e.target.files?.[0],
                    )
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
        {savedCount} value{savedCount === 1 ? "" : "s"} saved
      </p>
      <LocalDataControls onDataChanged={reload} />
    </form>
  );
};
