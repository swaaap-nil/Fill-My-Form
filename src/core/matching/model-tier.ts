import { z } from "zod";
import { Certainty } from "../agent/types";
import { LLMError } from "../errors";
import type { FieldSummary, FormField } from "../form/types";
import type { LLMMessage, LLMProvider } from "../llm/provider";
import type { Concept, ConceptIndex } from "../ontology/types";
import { type MatchResult, MatchTier } from "./types";

export interface ModelMappingPromptInput {
  /**
   * The cheap form outline may include every candidate field. Full field
   * context is passed separately, for only the target being mapped.
   */
  readonly fieldSummaries: readonly FieldSummary[];
  readonly field: FormField;
  readonly concepts: readonly Concept[];
}

export interface ModelConceptMapping {
  readonly fieldId: string;
  readonly conceptKey: string | null;
  readonly certainty: Certainty;
}

const conceptKeySchema = z
  .string()
  .regex(/^[a-z0-9]+(\.[a-z0-9_]+)+$/)
  .nullable();

export const modelConceptMappingSchema = z.object({
  fieldId: z.string(),
  conceptKey: conceptKeySchema,
  certainty: z.enum([
    Certainty.KNOWN,
    Certainty.UNKNOWN,
    Certainty.AMBIGUOUS,
    Certainty.REQUIRES_CONFIRMATION,
  ]),
});

const compactSummary = (field: FieldSummary) => ({
  id: field.id,
  kind: field.kind,
  label: field.label,
  required: field.required,
  hasValue: field.hasValue,
});

const compactField = (field: FormField) => ({
  id: field.id,
  kind: field.kind,
  label: field.label,
  name: field.name,
  placeholder: field.placeholder,
  autocomplete: field.autocomplete,
  description: field.description,
  nearbyText: field.nearbyText,
  options: field.options,
  constraints: field.constraints,
  required: field.required,
  hasValue: field.hasValue,
  disabled: field.disabled,
  readOnly: field.readOnly,
});

const compactConcept = (concept: Concept) => ({
  key: concept.key,
  label: concept.label,
  expects: concept.expects,
  aliases: concept.aliases,
});

export const buildModelMappingMessages = (
  input: ModelMappingPromptInput,
): readonly LLMMessage[] => [
  {
    role: "system",
    content: [
      "You map web form fields to canonical ontology concept keys.",
      "Return only a key from the provided ontology, or null when the field is not represented.",
      "Do not infer or invent a user value. Do not answer with free text.",
      "Use the full field context only for the target field.",
    ].join(" "),
  },
  {
    role: "user",
    content: JSON.stringify({
      task: "map_target_field_to_ontology_concept",
      fieldSummaries: input.fieldSummaries.map(compactSummary),
      targetField: compactField(input.field),
      allowedConcepts: input.concepts.map(compactConcept),
      outputContract: {
        fieldId: input.field.id,
        conceptKey: "one allowedConcepts.key, or null",
        certainty: Object.values(Certainty),
      },
    }),
  },
];

export const mapFieldWithModel = async (
  provider: LLMProvider,
  input: ModelMappingPromptInput,
  index: ConceptIndex,
): Promise<MatchResult> => {
  const response = await provider.generate<ModelConceptMapping>({
    messages: buildModelMappingMessages(input),
    schema: modelConceptMappingSchema,
    temperature: 0,
    maxOutputTokens: 200,
  });

  const mapping = response.value;
  if (mapping.fieldId !== input.field.id) {
    throw LLMError("Model mapped a different field than requested.", {
      context: { providerId: provider.id, fieldId: input.field.id },
    });
  }

  if (mapping.conceptKey === null || mapping.certainty !== Certainty.KNOWN) {
    return { candidates: [], certainty: Certainty.UNKNOWN };
  }

  const concept = index.byKey(mapping.conceptKey);
  if (!concept) {
    throw LLMError("Model returned an unknown ontology concept key.", {
      context: {
        providerId: provider.id,
        fieldId: input.field.id,
      },
    });
  }

  return {
    candidates: [
      {
        conceptKey: concept.key,
        tier: MatchTier.MODEL,
        score: 0.6,
      },
    ],
    certainty: Certainty.KNOWN,
  };
};
