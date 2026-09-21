import { Certainty } from "../agent/types";
import { FieldKind, type FormField, type UploadIntent } from "../form/types";
import type { ConceptIndex } from "../ontology/types";
import { resolve } from "./resolve";

const asFileField = (intent: UploadIntent): FormField => {
  const nearby = [intent.description, ...intent.requirements].filter(
    (value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index,
  );
  return {
    id: intent.id,
    kind: FieldKind.FILE,
    label: intent.label,
    description: intent.description,
    nearbyText: nearby.length > 0 ? nearby : undefined,
    required: false,
    hasValue: false,
    constraints: intent.constraints,
    disabled: false,
    readOnly: false,
  };
};

/**
 * Ontology key for a detected upload, only when the same matcher used for
 * known fields is certain (`documents.resume`). Generic "upload" / "document"
 * widgets return nothing so they do not get a memory-save card.
 */
export const conceptKeyForUploadIntent = (
  intent: UploadIntent,
  index: ConceptIndex,
): string | undefined => {
  const match = resolve(asFileField(intent), index);
  if (match.certainty !== Certainty.KNOWN) return undefined;
  const key = match.candidates[0]?.conceptKey;
  if (!key) return undefined;
  return index.byKey(key) ? key : undefined;
};

export interface RecognizedUploadRequirement {
  readonly conceptKey: string;
  readonly intent?: UploadIntent;
}

/**
 * Upload memory-save cards: recognized upload widgets plus file `no_value`
 * concepts, deduped, excluding concepts already remembered for this scan.
 */
export const recognizedUploadRequirements = (
  intents: readonly UploadIntent[],
  fileConceptKeys: readonly string[],
  rememberedKeys: ReadonlySet<string>,
  index: ConceptIndex,
): readonly RecognizedUploadRequirement[] => {
  const seen = new Set<string>();
  const requirements: RecognizedUploadRequirement[] = [];

  const add = (conceptKey: string, intent?: UploadIntent) => {
    if (rememberedKeys.has(conceptKey) || seen.has(conceptKey)) return;
    if (!index.byKey(conceptKey)) return;
    seen.add(conceptKey);
    requirements.push(intent ? { conceptKey, intent } : { conceptKey });
  };

  for (const intent of intents) {
    const key = conceptKeyForUploadIntent(intent, index);
    if (key) add(key, intent);
  }
  for (const key of fileConceptKeys) add(key);

  return requirements;
};
