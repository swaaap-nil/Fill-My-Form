import { Sensitivity } from "../ontology/types";
import {
  ActionRisk,
  ConfidenceLevel,
  type PolicyDecision,
  PolicyEffect,
  type PolicyEngine,
  type PolicyRequest,
} from "./types";

const allow = (reason: string): PolicyDecision => ({
  effect: PolicyEffect.ALLOW,
  reason,
});
const confirm = (reason: string): PolicyDecision => ({
  effect: PolicyEffect.REQUIRE_CONFIRMATION,
  reason,
});
const deny = (reason: string): PolicyDecision => ({
  effect: PolicyEffect.DENY,
  reason,
});

/**
 * Default policy: deny by default, allow narrowly.
 *
 * The rules are deliberately blunt for now. What matters is that they are all
 * in one function, ordered from strongest to weakest, so the real ruleset can
 * replace them without touching a single call site.
 */
export const defaultPolicy: PolicyEngine = {
  evaluate(request: PolicyRequest): PolicyDecision {
    // Submitting a form is never automatic. No confidence, no confirmation
    // and no setting changes this: the user presses submit themselves.
    if (request.isSubmission) {
      return deny("Final submission is always performed by the user.");
    }

    if (request.risk === ActionRisk.DESTRUCTIVE) {
      return deny("Irreversible actions are not automated.");
    }

    // Credentials, government ids, financial and health data.
    if (request.sensitivity === Sensitivity.RESTRICTED) {
      return request.userConfirmed
        ? allow("Restricted value explicitly confirmed by the user.")
        : confirm("Restricted data requires explicit confirmation.");
    }

    if (request.userConfirmed) {
      return allow("Confirmed by the user in this run.");
    }

    if (request.confidence === ConfidenceLevel.LOW) {
      return confirm("Confidence is too low to act without confirmation.");
    }

    // Non-personal, low-risk, well-understood: the only automatic path.
    if (
      request.sensitivity === Sensitivity.PUBLIC &&
      request.risk === ActionRisk.LOW
    ) {
      return allow("Non-personal, low-risk action.");
    }

    return confirm("Default: personal data is filled only after confirmation.");
  },
};
