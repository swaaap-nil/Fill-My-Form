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

import { FieldKind, type FormField } from "../form/types";
import { tierToConfidence } from "../matching/confidence";
import { resolve } from "../matching/resolve";
import { FreshnessStatus, freshness } from "../memory/freshness";
import type { MemoryStore } from "../memory/store";
import {
  isFileReference,
  type MemoryValue,
  type ProfileId,
} from "../memory/types";
import type { ConceptIndex, Sensitivity } from "../ontology/types";
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

/**
 * The risk of writing one resolved value into one page field: reversible
 * and visible to the user before submission, but a real write — not the
 * `LOW` risk reserved for reading page structure.
 */
const FILL_RISK: ActionRisk = ActionRisk.MEDIUM;

const fieldLabelOf = (field: FormField): string | undefined =>
  field.label ?? field.name ?? field.placeholder;

const payloadFor = (
  field: FormField,
  value: MemoryValue,
): PendingDecision["payload"] | null => {
  if (field.kind === FieldKind.FILE) {
    return isFileReference(value) ? { kind: "file", ref: value } : null;
  }
  return { kind: "text", value: String(value) };
};

const displayValueOf = (payload: PendingDecision["payload"]): string =>
  payload.kind === "file"
    ? `${payload.ref.name} (${Math.round(payload.ref.sizeBytes / 1024)} KB)`
    : payload.value;

export const planFill = async (
  fields: readonly FormField[],
  index: ConceptIndex,
  memory: MemoryStore,
  profileId: ProfileId,
  policy: PolicyEngine,
  generateDecisionId: () => DecisionId = () => crypto.randomUUID(),
  now: () => string = () => new Date().toISOString(),
): Promise<PlanFillResult> => {
  const proposals: FieldProposal[] = [];
  const decisions = new Map<DecisionId, PendingDecision>();

  for (const field of fields) {
    const match = resolve(field, index);
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

    const item = await memory.get(profileId, concept.key);
    if (!item) {
      proposals.push({
        fieldId: field.id,
        fieldLabel,
        state: "no_value",
        conceptKey: concept.key,
      });
      continue;
    }

    const itemFreshness = freshness(item, now());
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

    const payload = payloadFor(field, item.value);
    if (!payload) {
      proposals.push({
        fieldId: field.id,
        fieldLabel,
        state: "no_value",
        conceptKey: concept.key,
      });
      continue;
    }

    const decisionId = generateDecisionId();
    const value = displayValueOf(payload);

    decisions.set(decisionId, {
      fieldId: field.id,
      payload,
      constraints:
        field.kind === FieldKind.FILE ? field.constraints : undefined,
      conceptKey: concept.key,
      sensitivity: concept.sensitivity,
      risk: FILL_RISK,
      confidence,
      stale: itemFreshness === FreshnessStatus.DUE,
    });

    proposals.push({
      fieldId: field.id,
      fieldLabel,
      state: isRestricted(concept.sensitivity) ? "restricted" : "pending",
      conceptKey: concept.key,
      decisionId,
      value,
      payload,
      source: item.provenance.source,
      policyReason: decision.reason,
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
  };
};
