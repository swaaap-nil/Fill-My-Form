/**
 * The straight-line fill driver.
 *
 * Phase 1c's brief is explicit: no agent loop here — Phase 2 owns the
 * reducer and the loop and replaces this file's *driver*, not the pieces
 * it drives (`resolve`, `MemoryStore`, `PolicyEngine` all stay exactly as
 * they are). `planFill` is a plain async function that walks every field
 * once, in order:
 *
 * ```
 * resolve(field)  ->  memory lookup  ->  PolicyEngine.evaluate  ->  proposal
 * ```
 *
 * **Nothing here writes to a page.** This module produces `FieldProposal`s
 * and a map of pending decisions; the content script never sees either
 * until the side panel calls `confirmDecision` for a specific decisionId,
 * which only happens after the user has looked at the proposal. See
 * `~/core/messaging/fill-instruction` for the other half of that gate.
 */

import { Certainty } from "../agent/types";
import { FieldKind, type FormField, type FormOption } from "../form/types";
import { minConfidence, tierToConfidence } from "../matching/confidence";
import { resolve } from "../matching/resolve";
import {
  OPTION_TIER_CONFIDENCE,
  resolveOption,
} from "../matching/resolve-option";
import { FreshnessStatus, freshness } from "../memory/freshness";
import type { MemoryStore } from "../memory/store";
import {
  isFileReference,
  type MemoryValue,
  type ProfileId,
} from "../memory/types";
import type { Concept, ConceptIndex, Sensitivity } from "../ontology/types";
import { Sensitivity as SensitivityValue } from "../ontology/types";
import {
  ActionRisk,
  ConfidenceLevel,
  PolicyEffect,
  type PolicyEngine,
} from "../policy/types";
import type {
  ConfirmDecisionResult,
  DecisionId,
  FieldProposal,
  PendingDecision,
  PlanFillResult,
} from "./types";
import {
  adaptSocialProfileForField,
  calculateAge,
  isSocialProfileConcept,
  valueFromProfessionalExperience,
} from "./value-adapters";

/**
 * The risk of writing one resolved value into one page field: reversible
 * and visible to the user before submission, but a real write — not the
 * `LOW` risk reserved for reading page structure.
 */
const FILL_RISK: ActionRisk = ActionRisk.MEDIUM;

const fieldLabelOf = (field: FormField): string | undefined =>
  field.label ?? field.name ?? field.placeholder;

export type ResolvedStoredValue =
  | {
      readonly kind: "fillable";
      readonly payload: PendingDecision["payload"];
      readonly displayValue: string;
      readonly confidence: ConfidenceLevel;
      readonly memoryValue?: string;
      readonly memoryWrite?:
        | false
        | { readonly key: string; readonly value: MemoryValue };
      readonly constraints?: FormField["constraints"];
    }
  | {
      readonly kind: "choose_option";
      readonly storedValue: string;
      readonly candidates: readonly FormOption[];
    }
  | { readonly kind: "no_value" };

export const payloadFor = (
  field: FormField,
  value: MemoryValue,
): PendingDecision["payload"] | null => {
  if (field.kind === FieldKind.FILE) {
    return isFileReference(value) ? { kind: "file", ref: value } : null;
  }
  return { kind: "text", value: String(value) };
};

export const displayValueOf = (payload: PendingDecision["payload"]): string =>
  payload.kind === "file"
    ? `${payload.ref.name} (${Math.round(payload.ref.sizeBytes / 1024)} KB)`
    : payload.value;

export const resolveStoredValueForField = (
  field: FormField,
  value: MemoryValue,
  concept: Concept,
  confidence: ConfidenceLevel,
  locale?: string,
): ResolvedStoredValue => {
  const payload = payloadFor(field, value);
  if (!payload) return { kind: "no_value" };

  if (payload.kind === "text" && isSocialProfileConcept(concept.key)) {
    const adapted = adaptSocialProfileForField(
      concept.key,
      payload.value,
      field,
    );
    return {
      kind: "fillable",
      payload: { kind: "text", value: adapted.value },
      displayValue: adapted.value,
      confidence,
      memoryValue: adapted.canonicalValue,
      memoryWrite: { key: concept.key, value: adapted.canonicalValue },
    };
  }

  // Closed-vocabulary fields must receive one of the page's own option values.
  // The user's stored text remains the memory value; the DOM write uses the
  // option code/label the page actually exposes.
  if (payload.kind === "text" && field.options && field.options.length > 0) {
    const optionMatch = resolveOption(
      payload.value,
      field.options,
      concept,
      locale,
    );

    if (optionMatch.certainty === Certainty.AMBIGUOUS) {
      return {
        kind: "choose_option",
        storedValue: payload.value,
        candidates: optionMatch.candidates,
      };
    }

    if (optionMatch.certainty === Certainty.UNKNOWN) {
      return {
        kind: "choose_option",
        storedValue: payload.value,
        candidates: field.options,
      };
    }

    return {
      kind: "fillable",
      payload: { kind: "text", value: optionMatch.option.value },
      displayValue: optionMatch.option.label,
      confidence: minConfidence(
        confidence,
        OPTION_TIER_CONFIDENCE[optionMatch.tier],
      ),
      memoryValue: payload.value,
    };
  }

  return {
    kind: "fillable",
    payload,
    displayValue: displayValueOf(payload),
    confidence,
    constraints: field.kind === FieldKind.FILE ? field.constraints : undefined,
  };
};

/**
 * Registers one decision per candidate option, for the panel's
 * `"choose_option"` picker. Each already has a live `decisionId` — picking
 * one is the ordinary `confirm([decisionId])` flow, no protocol change.
 */
const registerOptionChoices = (
  decisions: Map<DecisionId, PendingDecision>,
  generateDecisionId: () => DecisionId,
  field: FormField,
  conceptKey: string,
  sensitivity: Sensitivity,
  candidates: readonly FormOption[],
): readonly { readonly decisionId: DecisionId; readonly label: string }[] =>
  candidates.map((option) => {
    const decisionId = generateDecisionId();
    decisions.set(decisionId, {
      fieldId: field.id,
      payload: { kind: "text", value: option.value },
      conceptKey,
      sensitivity,
      risk: FILL_RISK,
      confidence: ConfidenceLevel.LOW,
      memoryValue: option.label,
    });
    return { decisionId, label: option.label };
  });

export const resolveMemoryItemForConcept = async (
  concept: Concept,
  memory: Pick<MemoryStore, "get">,
  profileId: ProfileId,
  nowIso: string,
): Promise<
  | {
      readonly value: MemoryValue;
      readonly sourceItem: Awaited<ReturnType<MemoryStore["get"]>>;
      readonly displayPrefix?: string;
      readonly memoryWrite?:
        | false
        | { readonly key: string; readonly value: MemoryValue };
    }
  | undefined
> => {
  const direct = await memory.get(profileId, concept.key);
  if (direct) return { value: direct.value, sourceItem: direct };

  if (concept.key === "identity.age") {
    const dob = await memory.get(profileId, "identity.date_of_birth");
    if (typeof dob?.value !== "string") return undefined;
    const age = calculateAge(dob.value, nowIso);
    return age
      ? {
          value: age,
          sourceItem: dob,
          displayPrefix: "Derived from date of birth",
          memoryWrite: false,
        }
      : undefined;
  }

  if (concept.key === "documents.cv") {
    const resume = await memory.get(profileId, "documents.resume");
    if (!resume) return undefined;
    return {
      value: resume.value,
      sourceItem: resume,
      displayPrefix: "Resume fallback for CV",
      memoryWrite: false,
    };
  }

  const experience = await memory.get(
    profileId,
    "experience.professional.roles",
  );
  if (experience) {
    const derived = valueFromProfessionalExperience(
      concept.key,
      experience.value,
    );
    if (derived) {
      return {
        value: derived,
        sourceItem: experience,
        memoryWrite: false,
      };
    }
  }

  return undefined;
};

export const planFill = async (
  fields: readonly FormField[],
  index: ConceptIndex,
  memory: MemoryStore,
  profileId: ProfileId,
  policy: PolicyEngine,
  generateDecisionId: () => DecisionId = () => crypto.randomUUID(),
  now: () => string = () => new Date().toISOString(),
  locale?: string,
): Promise<PlanFillResult> => {
  const proposals: FieldProposal[] = [];
  const decisions = new Map<DecisionId, PendingDecision>();

  for (const field of fields) {
    const match = resolve(field, index, locale);
    const fieldLabel = fieldLabelOf(field);

    if (match.certainty === "unknown") {
      proposals.push({ fieldId: field.id, fieldLabel, state: "unknown" });
      continue;
    }

    if (match.certainty === "ambiguous") {
      proposals.push({
        fieldId: field.id,
        fieldLabel,
        state: "ambiguous",
        candidates: match.candidates.map((c) => c.conceptKey),
      });
      continue;
    }

    // certainty === "known": exactly one candidate, by construction of resolve().
    const candidate = match.candidates[0];
    const concept = candidate ? index.byKey(candidate.conceptKey) : undefined;
    if (!candidate || !concept) {
      // Defensive: resolve() promised a concept key that isn't in this
      // index. Treat as unresolved rather than propose a dangling key.
      proposals.push({ fieldId: field.id, fieldLabel, state: "unknown" });
      continue;
    }

    const nowIso = now();
    const resolvedItem = await resolveMemoryItemForConcept(
      concept,
      memory,
      profileId,
      nowIso,
    );
    if (!resolvedItem?.sourceItem) {
      proposals.push({
        fieldId: field.id,
        fieldLabel,
        state: "no_value",
        conceptKey: concept.key,
      });
      continue;
    }
    const item = resolvedItem.sourceItem;

    const itemFreshness = freshness(item, nowIso);
    const confidence =
      itemFreshness === FreshnessStatus.DUE
        ? ConfidenceLevel.LOW
        : tierToConfidence(candidate.tier);
    const decision = policy.evaluate({
      risk: FILL_RISK,
      sensitivity: concept.sensitivity,
      confidence,
      isSubmission: false,
      userConfirmed: false,
    });

    const resolvedValue = resolveStoredValueForField(
      field,
      resolvedItem.value,
      concept,
      confidence,
      locale,
    );
    if (resolvedValue.kind === "no_value") {
      proposals.push({
        fieldId: field.id,
        fieldLabel,
        state: "no_value",
        conceptKey: concept.key,
      });
      continue;
    }

    if (resolvedValue.kind === "choose_option") {
      proposals.push({
        fieldId: field.id,
        fieldLabel,
        state: "choose_option",
        conceptKey: concept.key,
        storedValue: resolvedValue.storedValue,
        choices: registerOptionChoices(
          decisions,
          generateDecisionId,
          field,
          concept.key,
          concept.sensitivity,
          resolvedValue.candidates,
        ),
      });
      continue;
    }

    const decisionId = generateDecisionId();
    const resolvedDecision =
      resolvedValue.confidence === confidence
        ? decision
        : policy.evaluate({
            risk: FILL_RISK,
            sensitivity: concept.sensitivity,
            confidence: resolvedValue.confidence,
            isSubmission: false,
            userConfirmed: false,
          });

    decisions.set(decisionId, {
      fieldId: field.id,
      payload: resolvedValue.payload,
      constraints: resolvedValue.constraints,
      conceptKey: concept.key,
      sensitivity: concept.sensitivity,
      risk: FILL_RISK,
      confidence: resolvedValue.confidence,
      stale: itemFreshness === FreshnessStatus.DUE,
      memoryValue: resolvedValue.memoryValue,
      memoryWrite: resolvedValue.memoryWrite ?? resolvedItem.memoryWrite,
    });

    const displayValue = resolvedItem.displayPrefix
      ? `${resolvedItem.displayPrefix}: ${resolvedValue.displayValue}`
      : resolvedValue.displayValue;

    proposals.push({
      fieldId: field.id,
      fieldLabel,
      state: isRestricted(concept.sensitivity) ? "restricted" : "pending",
      conceptKey: concept.key,
      decisionId,
      value: displayValue,
      payload: resolvedValue.payload,
      source: item.provenance.source,
      policyReason: resolvedDecision.reason,
    });
  }

  return { proposals, decisions };
};

const isRestricted = (sensitivity: Sensitivity): boolean =>
  sensitivity === SensitivityValue.RESTRICTED;

/**
 * Re-runs policy for a previously-planned decision with
 * `userConfirmed: true` — the only way a `PendingDecision` becomes
 * something the content script may act on. Never trusts a value or
 * sensitivity the caller passes in; both come from the map `planFill`
 * built, keyed only by the opaque `decisionId`.
 */
export const confirmDecision = (
  decision: PendingDecision,
  policy: PolicyEngine,
): ConfirmDecisionResult => {
  const result = policy.evaluate({
    risk: decision.risk,
    sensitivity: decision.sensitivity,
    confidence: decision.confidence,
    isSubmission: false,
    userConfirmed: true,
  });

  return {
    ok: result.effect === PolicyEffect.ALLOW,
    fieldId: decision.fieldId,
    payload: decision.payload,
    memoryValue: decision.memoryValue,
    memoryWrite: decision.memoryWrite,
  };
};
