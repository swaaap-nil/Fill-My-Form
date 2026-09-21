import { Certainty } from "../agent/types";
import { FieldKind, type FormField, type UploadIntent } from "../form/types";
import type { ConceptIndex } from "../ontology/types";
import { resolve } from "./resolve";

const GENERIC_UPLOAD_LABEL =
  /^(attach|upload|browse|choose file|choose|select)(?:\s+file)?\.?$/i;

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

const kindFallbackName = (intent: UploadIntent): string => {
  if (intent.kind === "photo") return "photograph";
  if (intent.kind === "signature") return "signature";
  if (intent.kind === "document") {
    const source = [intent.label, intent.description, ...intent.requirements]
      .filter((value): value is string => Boolean(value))
      .join(" ");
    if (/\bcertificate\b/i.test(source)) return "certificate";
    return "document";
  }
  const label = intent.label?.trim();
  if (label && !GENERIC_UPLOAD_LABEL.test(label)) return label;
  return "upload";
};

/**
 * Name shown in "We know this is …". Prefers the ontology concept key the
 * same matcher uses for known fields (`documents.resume`), and only falls
 * back to the coarse upload kind when nothing resolves.
 */
export const nameForUploadIntent = (
  intent: UploadIntent,
  index: ConceptIndex,
): string => {
  const match = resolve(asFileField(intent), index);
  if (match.certainty === Certainty.KNOWN) {
    const concept = index.byKey(match.candidates[0]?.conceptKey ?? "");
    if (concept) return concept.key;
  }
  return kindFallbackName(intent);
};
