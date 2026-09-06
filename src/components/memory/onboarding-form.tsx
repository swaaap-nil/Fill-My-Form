import { Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { concepts } from "~/core/ontology";
import { Sensitivity } from "~/core/ontology/types";
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
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const loadSnapshot = () => {
    sendMessage("getMemorySnapshot", undefined).then(({ items }) => {
      const loaded: Record<string, string> = {};
      for (const item of items) {
        if (typeof item.value === "string") loaded[item.key] = item.value;
      }
      setValues(loaded);
      setSavedKeys(new Set(items.map((i) => i.key)));
    });
  };

  useEffect(loadSnapshot, []);

  const groupedStandard = useMemo(() => groupByPrefix(standardConcepts), []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);

    const entries = Object.entries(values).filter(([, v]) => v.trim() !== "");
    await Promise.all(
      entries.map(([key, value]) => {
        const concept = fillableConcepts.find((c) => c.key === key);
        return sendMessage("recordOnboardingAnswer", {
          key,
          value,
          label: concept?.label,
        });
      }),
    );

    setSavedKeys(new Set(entries.map(([key]) => key)));
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-6">
      {groupedStandard.map(([group, items]) => (
        <fieldset key={group} className="flex flex-col gap-3">
          <legend className="font-semibold text-sm">{group}</legend>
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

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
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
