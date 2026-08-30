import type { Sensitivity } from "../ontology/types";

/**
 * The policy engine decides what the runtime is willing to do. The model
 * proposes; this module disposes.
 *
 * Day one is a default-deny stub. The shape matters more than the rules:
 * every automatic action passes through `PolicyEngine.evaluate`, so tightening
 * or relaxing behaviour later is a change in one place.
 */

export const ActionRisk = {
  /** Reversible, non-identifying. Reading page structure. */
  LOW: "low",
  /** Writes a value the user can see and undo. */
  MEDIUM: "medium",
  /** Discloses sensitive data, or attaches a file. */
  HIGH: "high",
  /** Not reversible from inside the page. Submission, payment. */
  DESTRUCTIVE: "destructive",
} as const;

export type ActionRisk = (typeof ActionRisk)[keyof typeof ActionRisk];

/** Sensitivity of the *field being acted on*, mirroring ontology sensitivity. */
export type FieldSensitivity = Sensitivity;

export const ConfidenceLevel = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CERTAIN: "certain",
} as const;

export type ConfidenceLevel =
  (typeof ConfidenceLevel)[keyof typeof ConfidenceLevel];

export const toConfidenceLevel = (score: number): ConfidenceLevel => {
  if (score >= 1) return ConfidenceLevel.CERTAIN;
  if (score >= 0.85) return ConfidenceLevel.HIGH;
  if (score >= 0.6) return ConfidenceLevel.MEDIUM;
  return ConfidenceLevel.LOW;
};

export const PolicyEffect = {
  ALLOW: "allow",
  REQUIRE_CONFIRMATION: "require_confirmation",
  DENY: "deny",
} as const;

export type PolicyEffect = (typeof PolicyEffect)[keyof typeof PolicyEffect];

export interface PolicyDecision {
  readonly effect: PolicyEffect;
  /** Non-personal. Shown to the user and written to logs. */
  readonly reason: string;
}

export interface PolicyRequest {
  readonly risk: ActionRisk;
  readonly sensitivity: FieldSensitivity;
  readonly confidence: ConfidenceLevel;
  /** True for the final submit control. */
  readonly isSubmission: boolean;
  /** True once the user has approved this exact value in this run. */
  readonly userConfirmed: boolean;
}

export interface PolicyEngine {
  evaluate(request: PolicyRequest): PolicyDecision;
}
