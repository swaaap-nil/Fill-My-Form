/**
 * The shapes `~/core/fill/driver` produces. Pure data — no DOM, no
 * `MemoryStore` instance, no browser messaging — so the driver that builds
 * them is unit-testable with a fake memory lookup and stays exactly as
 * testable when Phase 2 replaces the driver that calls it.
 */

import type { FieldConstraint, FieldId } from "../form/types";
import type { FileReference, MemorySource } from "../memory/types";
import type { Sensitivity } from "../ontology/types";
import type { ActionRisk, ConfidenceLevel } from "../policy/types";

/** Opaque, issued only by `planFill`. Never constructed anywhere else. */
export type DecisionId = string;

export type FillPayload =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "file"; readonly ref: FileReference };

interface FieldProposalBase {
  readonly fieldId: FieldId;
  readonly fieldLabel?: string;
}

/** One field's outcome after matching, memory lookup, and policy. */
export type FieldProposal =
  | (FieldProposalBase & { readonly state: "unknown" })
  | (FieldProposalBase & {
      readonly state: "ambiguous";
      readonly candidates: readonly string[];
    })
  | (FieldProposalBase & {
      readonly state: "no_value";
      readonly conceptKey: string;
    })
  | (FieldProposalBase & {
      /**
       * The concept resolved, and a value is stored, but it didn't map
       * cleanly onto one of the field's own options (`<select>`,
       * radio/checkbox) — either two-or-more equally plausible options, or
       * none. `choices` is always non-empty and each entry already has a
       * live `decisionId`; confirming any of them is the ordinary
       * `confirm([decisionId])` flow. See `~/core/matching/resolve-option`.
       */
      readonly state: "choose_option";
      readonly conceptKey: string;
      readonly storedValue: string;
      readonly choices: readonly {
        readonly decisionId: DecisionId;
        readonly label: string;
      }[];
    })
  | (FieldProposalBase & {
      /** `restricted` when the concept's sensitivity demands it always asks. */
      readonly state: "pending" | "restricted";
      readonly conceptKey: string;
      readonly decisionId: DecisionId;
      /** Stringified for the wire; nothing downstream needs the raw `MemoryValue`. */
      readonly value: string;
      readonly payload: FillPayload;
      readonly source: MemorySource;
      readonly policyReason: string;
    });

/**
 * What `planFill` remembers about one decisionId, so `confirmDecision` can
 * re-run policy with `userConfirmed: true` without trusting anything the
 * panel sends back except the id itself.
 */
export interface PendingDecision {
  readonly fieldId: FieldId;
  readonly payload: FillPayload;
  readonly constraints?: readonly FieldConstraint[];
  readonly conceptKey: string;
  readonly sensitivity: Sensitivity;
  readonly risk: ActionRisk;
  readonly confidence: ConfidenceLevel;
  readonly stale?: boolean;
  /**
   * What to persist back to memory on confirm, when it must differ from
   * `payload.value` — e.g. a select/radio field writes a page-specific
   * option `value` ("2") to the DOM but must not overwrite the concept's
   * canonical memory value with that opaque code. Absent means
   * `payload.value` is fine for both purposes, the case for every
   * non-option field.
   */
  readonly memoryValue?: string;
}

export interface PlanFillResult {
  readonly proposals: readonly FieldProposal[];
  readonly decisions: ReadonlyMap<DecisionId, PendingDecision>;
}

export interface ConfirmDecisionResult {
  readonly ok: boolean;
  readonly fieldId: FieldId;
  readonly payload: FillPayload;
  readonly memoryValue?: string;
}
