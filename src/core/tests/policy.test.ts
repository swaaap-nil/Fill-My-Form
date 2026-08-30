import { describe, expect, it } from "bun:test";
import { Sensitivity } from "~/core/ontology/types";
import { defaultPolicy } from "~/core/policy/default";
import {
  ActionRisk,
  ConfidenceLevel,
  PolicyEffect,
  type PolicyRequest,
} from "~/core/policy/types";

const request = (overrides: Partial<PolicyRequest> = {}): PolicyRequest => ({
  risk: ActionRisk.MEDIUM,
  sensitivity: Sensitivity.PERSONAL,
  confidence: ConfidenceLevel.HIGH,
  isSubmission: false,
  userConfirmed: false,
  ...overrides,
});

describe("defaultPolicy", () => {
  it("never automates final submission, however confident and confirmed", () => {
    const decision = defaultPolicy.evaluate(
      request({
        isSubmission: true,
        userConfirmed: true,
        confidence: ConfidenceLevel.CERTAIN,
        sensitivity: Sensitivity.PUBLIC,
        risk: ActionRisk.LOW,
      }),
    );

    expect(decision.effect).toBe(PolicyEffect.DENY);
  });

  it("denies destructive actions", () => {
    expect(
      defaultPolicy.evaluate(request({ risk: ActionRisk.DESTRUCTIVE })).effect,
    ).toBe(PolicyEffect.DENY);
  });

  it("requires confirmation for restricted data even at full confidence", () => {
    expect(
      defaultPolicy.evaluate(
        request({
          sensitivity: Sensitivity.RESTRICTED,
          confidence: ConfidenceLevel.CERTAIN,
        }),
      ).effect,
    ).toBe(PolicyEffect.REQUIRE_CONFIRMATION);
  });

  it("allows restricted data once the user has confirmed it", () => {
    expect(
      defaultPolicy.evaluate(
        request({ sensitivity: Sensitivity.RESTRICTED, userConfirmed: true }),
      ).effect,
    ).toBe(PolicyEffect.ALLOW);
  });

  it("requires confirmation at low confidence", () => {
    expect(
      defaultPolicy.evaluate(request({ confidence: ConfidenceLevel.LOW }))
        .effect,
    ).toBe(PolicyEffect.REQUIRE_CONFIRMATION);
  });

  it("allows only the non-personal, low-risk case automatically", () => {
    expect(
      defaultPolicy.evaluate(
        request({ sensitivity: Sensitivity.PUBLIC, risk: ActionRisk.LOW }),
      ).effect,
    ).toBe(PolicyEffect.ALLOW);
  });

  it("defaults to confirmation for personal data", () => {
    expect(defaultPolicy.evaluate(request()).effect).toBe(
      PolicyEffect.REQUIRE_CONFIRMATION,
    );
  });

  it("always explains itself, so the UI never shows a bare refusal", () => {
    expect(defaultPolicy.evaluate(request()).reason.length).toBeGreaterThan(0);
  });
});
