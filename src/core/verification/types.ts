import type { FieldId } from "../form/types";

/**
 * Verification is a first-class step, not an afterthought.
 *
 * A tool returning without throwing proves only that our code ran. It does not
 * prove the page accepted the input: a React-controlled input can reject a
 * programmatic value, a select can silently keep its old option, a masked
 * field can reformat what was typed. So after ACT we read the DOM back and
 * compare intent against reality.
 */

export const VerificationIssueCode = {
  /** The field still holds a different value. */
  VALUE_MISMATCH: "value_mismatch",
  /** The field is empty after a fill. */
  NOT_APPLIED: "not_applied",
  /** The page reformatted the value; may or may not be acceptable. */
  VALUE_NORMALISED: "value_normalised",
  /** The page is showing its own validation error for this field. */
  FIELD_INVALID: "field_invalid",
  /** The field is gone — the DOM changed under us. */
  FIELD_MISSING: "field_missing",
  /** New fields appeared as a result of the action. */
  FORM_CHANGED: "form_changed",
} as const;

export type VerificationIssueCode =
  (typeof VerificationIssueCode)[keyof typeof VerificationIssueCode];

/**
 * `expected` and `actual` may contain personal data. They exist for the review
 * UI and for the agent's next decision. They must never be logged or sent to
 * telemetry — log `code` and `fieldId` only.
 */
export interface VerificationIssue {
  readonly code: VerificationIssueCode;
  readonly fieldId?: FieldId;
  /** Non-personal explanation, safe to display and to log. */
  readonly message: string;
  readonly expected?: string;
  readonly actual?: string;
}

export interface VerificationResult {
  readonly ok: boolean;
  readonly issues: readonly VerificationIssue[];
  readonly verifiedAt: string;
}

/** What the runtime intended one action to achieve. */
export interface VerificationIntent {
  readonly fieldId: FieldId;
  readonly expectedValue: string;
}

export interface Verifier {
  verify(intent: VerificationIntent): Promise<VerificationResult>;
}

export const passed = (): VerificationResult => ({
  ok: true,
  issues: [],
  verifiedAt: new Date().toISOString(),
});

export const failed = (
  issues: readonly VerificationIssue[],
): VerificationResult => ({
  ok: false,
  issues,
  verifiedAt: new Date().toISOString(),
});
