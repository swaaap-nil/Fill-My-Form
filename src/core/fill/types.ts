/**
 * The shapes `~/core/fill/driver` produces. Pure data — no DOM, no
 * `MemoryStore` instance, no browser messaging — so the driver that builds
 * them is unit-testable with a fake memory lookup and stays exactly as
 * testable when Phase 2 replaces the driver that calls it.
 */

import type { FieldId } from "../form/types";
import type { MemorySource } from "../memory/types";
import type { Sensitivity } from "../ontology/types";
import type { ActionRisk, ConfidenceLevel } from "../policy/types";

/** Opaque, issued only by `planFill`. Never constructed anywhere else. */
export type DecisionId = string;

/** One field's outcome after matching, memory lookup, and policy. */
export type FieldProposal =
  | { readonly fieldId: FieldId; readonly state: "unknown" }
  | {
      readonly fieldId: FieldId;
      readonly state: "ambiguous";
      readonly candidates: readonly string[];
    }
  | {
      readonly fieldId: FieldId;
      readonly state: "no_value";
      readonly conceptKey: string;
    }
  | {
      readonly fieldId: FieldId;
      /** `restricted` when the concept's sensitivity demands it always asks. */
      readonly state: "pending" | "restricted";
      readonly conceptKey: string;
      readonly decisionId: DecisionId;
      /** Stringified for the wire; nothing downstream needs the raw `MemoryValue`. */
      readonly value: string;
      readonly source: MemorySource;
      readonly policyReason: string;
    };

/**
 * What `planFill` remembers about one decisionId, so `confirmDecision` can
 * re-run policy with `userConfirmed: true` without trusting anything the
 * panel sends back except the id itself.
 */
export interface PendingDecision {
  readonly fieldId: FieldId;
  readonly value: string;
  readonly conceptKey: string;
  readonly sensitivity: Sensitivity;
  readonly risk: ActionRisk;
  readonly confidence: ConfidenceLevel;
}

export interface PlanFillResult {
  readonly proposals: readonly FieldProposal[];
  readonly decisions: ReadonlyMap<DecisionId, PendingDecision>;
}

export interface ConfirmDecisionResult {
  readonly ok: boolean;
  readonly fieldId: FieldId;
  readonly value: string;
}
