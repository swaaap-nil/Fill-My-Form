import { FileUp, Lock, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  isProfessionalExperienceList,
  type ProfessionalExperienceEntry,
} from "~/core/fill/value-adapters";
import type { MemoryValue } from "~/core/memory/types";
import { concepts } from "~/core/ontology";
import { Sensitivity } from "~/core/ontology/types";
import { AnalyticsPreferenceControl } from "./analytics-preference-control";
import { AutosaveStatusIcon, AutosaveTextField } from "./autosave-text-field";
import { LocalDataControls } from "./local-data-controls";
import { type FieldStatus, useMemoryAutosave } from "./use-memory-autosave";

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
 * the brief's "Out of scope"), so `expects: "file"` concepts are excluded
 * from the text mapping and handled as native file inputs below.
 *
 * {@link Sensitivity.RESTRICTED} concepts are grouped into their own
 * section, presented last and marked with a lock icon — "respect
 * sensitivity in how prominently a field is presented" from the brief.
 */

const groupLabel = (key: string): string => {
  const [prefix] = key.split(".");
  if (!prefix) return "Other";
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
};

const DERIVED_CONCEPT_KEYS = new Set(["identity.age"]);
const STRUCTURED_CONCEPT_KEYS = new Set(["experience.professional.roles"]);
const fileConcepts = concepts.filter((c) => c.expects === "file");
const fillableConcepts = concepts.filter(
  (c) =>
    c.expects !== "file" &&
    !DERIVED_CONCEPT_KEYS.has(c.key) &&
    !STRUCTURED_CONCEPT_KEYS.has(c.key),
);
const structuredConcepts = concepts.filter((c) =>
  STRUCTURED_CONCEPT_KEYS.has(c.key),
);
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

const emptyExperience = (): ProfessionalExperienceEntry => ({
  id: `experience-${Date.now()}-${Math.random()}`,
  organization: "",
  role: "",
  description: "",
  startDate: "",
  endDate: null,
  isCurrent: false,
});

const normalizeExperience = (
  value: MemoryValue | undefined,
): ProfessionalExperienceEntry[] =>
  isProfessionalExperienceList(value) && value.length > 0
    ? value.map((entry) => ({ ...emptyExperience(), ...entry }))
    : [emptyExperience()];

const ProfessionalExperienceEditor = ({
  value,
  status,
  onChange,
}: {
  readonly value: MemoryValue | undefined;
  readonly status: FieldStatus;
  readonly onChange: (value: MemoryValue) => void;
}) => {
  const entries = normalizeExperience(value);
  const updateEntry = (
    index: number,
    patch: Partial<ProfessionalExperienceEntry>,
  ) => {
    onChange(
      entries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    );
  };
  const removeEntry = (index: number) => {
    const next = entries.filter((_, entryIndex) => entryIndex !== index);
    onChange(next.length > 0 ? next : [emptyExperience()]);
  };

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry, index) => (
        <div
          className="grid gap-2 rounded-md border border-border p-2"
          key={String(
            entry.id ??
              `${entry.organization}-${entry.role}-${entry.startDate}`,
          )}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              aria-label={`Experience ${index + 1} organization`}
              placeholder="Organization"
              value={entry.organization ?? ""}
              onChange={(event) =>
                updateEntry(index, { organization: event.target.value })
              }
            />
            <Input
              aria-label={`Experience ${index + 1} role`}
              placeholder="Role"
              value={entry.role ?? ""}
              onChange={(event) =>
                updateEntry(index, { role: event.target.value })
              }
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              aria-label={`Experience ${index + 1} start date`}
              type="date"
              value={entry.startDate ?? ""}
              onChange={(event) =>
                updateEntry(index, { startDate: event.target.value })
              }
            />
            <Input
              aria-label={`Experience ${index + 1} end date`}
              type="date"
              value={entry.endDate ?? ""}
              onChange={(event) =>
                updateEntry(index, {
                  endDate: event.target.value || null,
                  isCurrent: !event.target.value ? entry.isCurrent : false,
                })
              }
            />
            <label className="flex items-center gap-2 whitespace-nowrap text-sm">
              <input
                checked={entry.isCurrent ?? false}
                type="checkbox"
                onChange={(event) =>
                  updateEntry(index, {
                    isCurrent: event.target.checked,
                    endDate: event.target.checked ? null : entry.endDate,
                  })
                }
              />
              Current
            </label>
          </div>
          <Textarea
            aria-label={`Experience ${index + 1} description`}
            placeholder="Description"
            value={entry.description ?? ""}
            onChange={(event) =>
              updateEntry(index, { description: event.target.value })
            }
          />
          <div className="flex items-center justify-between">
            <div className="relative h-5 w-5">
              <AutosaveStatusIcon
                fieldKey={`experience-${index}`}
                status={status}
              />
            </div>
            <Button
              aria-label={`Remove experience ${index + 1}`}
              size="icon"
              type="button"
              variant="ghost"
              onClick={() => removeEntry(index)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        className="self-start gap-2"
        type="button"
        variant="outline"
        onClick={() => onChange([...entries, emptyExperience()])}
      >
        <Plus className="size-4" />
        Add experience
      </Button>
    </div>
  );
};

export const OnboardingForm = () => {
  const {
    fileRefs,
    getStatus,
    reload,
    savedCount,
    structuredValues,
    updateFileField,
    updateStructuredField,
    updateTextField,
    values,
  } = useMemoryAutosave();
  const groupedStandard = useMemo(() => groupByPrefix(standardConcepts), []);

  const renderTextField = (concept: (typeof fillableConcepts)[number]) => (
    <AutosaveTextField
      key={concept.key}
      fieldKey={concept.key}
      label={concept.label}
      expects={concept.expects}
      value={values[concept.key] ?? ""}
      status={getStatus(concept.key)}
      onChange={(value) => updateTextField(concept.key, value, concept.label)}
    />
  );

  return (
    <form
      className="flex w-full flex-col gap-5"
      onSubmit={(event) => event.preventDefault()}
    >
      <p className="rounded-lg border border-primary/35 bg-primary/10 p-3.5 text-foreground text-sm leading-relaxed shadow-sm shadow-primary/10 dark:bg-primary/15 dark:shadow-black/20">
        You can add everything here,{" "}
        <span className="font-semibold">but you should not</span> have to. Start
        on any form and Fill My Form will ask only what it needs.
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

      {structuredConcepts.map((concept) => (
        <fieldset
          key={concept.key}
          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/5 dark:shadow-black/20"
        >
          <legend className="px-1 font-semibold text-sm text-foreground">
            {concept.label}
          </legend>
          <ProfessionalExperienceEditor
            status={getStatus(concept.key)}
            value={structuredValues[concept.key]}
            onChange={(value) =>
              updateStructuredField(concept.key, value, concept.label)
            }
          />
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
                <AutosaveStatusIcon
                  fieldKey={concept.key}
                  status={getStatus(concept.key)}
                />
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
      <AnalyticsPreferenceControl />
    </form>
  );
};
