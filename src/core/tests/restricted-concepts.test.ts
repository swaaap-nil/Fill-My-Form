import { describe, expect, it } from "bun:test";
import { Certainty } from "~/core/agent/types";
import { FieldKind, type FormField } from "~/core/form/types";
import { tierToConfidence } from "~/core/matching/confidence";
import { resolve } from "~/core/matching/resolve";
import { concepts, ontology } from "~/core/ontology";
import { Sensitivity } from "~/core/ontology/types";
import { defaultPolicy } from "~/core/policy/default";
import { ActionRisk, type PolicyRequest } from "~/core/policy/types";

/**
 * `messy.html`'s `fld_11` (Aadhaar) was untouched before this phase because
 * it resolved to `UNKNOWN` — indistinguishable from any other unmapped
 * field. `defaultPolicy`'s RESTRICTED branch existed but nothing in the
 * fixture built to exercise it actually reached it. These tests convert
 * that from an accident of "nothing matched" into a property the ontology
 * and the matcher jointly guarantee.
 */

const RESTRICTED_KEYS = [
  "documents.national_id",
  "documents.tax_id",
  "documents.passport_number",
  "documents.passport_expiry",
  "documents.driving_license_number",
  "documents.voter_id",
  "bank.account_number",
  "bank.account_holder_name",
  "bank.branch_name",
  "bank.account_type",
  "bank.ifsc_code",
  "employment.current.salary",
  "identity.blood_group",
  "identity.ssn",
  "identity.work_authorization",
  "identity.visa_type",
  "identity.visa_expiry",
  // Protected-characteristic EEO data (US job applications). Not a
  // government id, financial value or health record in the literal sense
  // `Sensitivity.RESTRICTED`'s doc comment lists, but auto-filling any of
  // these without the user's direct attention is exactly the harm
  // `restricted` exists to prevent — a judgment call worth flagging, not
  // one to make silently.
  "identity.veteran_status",
  "identity.disability_status",
  "identity.race_ethnicity",
];

describe("restricted concepts exist and are marked as such", () => {
  it("every government id, financial or health concept is sensitivity: restricted", () => {
    for (const key of RESTRICTED_KEYS) {
      const concept = ontology.byKey(key);
      expect(concept).toBeDefined();
      expect(concept?.sensitivity).toBe(Sensitivity.RESTRICTED);
    }
  });

  it("has at least one restricted concept — the RESTRICTED policy branch is reachable", () => {
    const restricted = concepts.filter(
      (c) => c.sensitivity === Sensitivity.RESTRICTED,
    );
    expect(restricted.length).toBeGreaterThan(0);
  });
});

describe("fld_11 (Aadhaar): resolves restricted, and policy never auto-fills it", () => {
  const field: FormField = {
    id: "0/aadhaar/0",
    kind: FieldKind.TEXT,
    label: "Aadhaar Number",
    required: false,
    hasValue: false,
    nearbyText: ["restricted: must never be auto-filled"],
    constraints: [],
    disabled: false,
    readOnly: false,
  };

  it("the matcher resolves it to the restricted national-id concept", () => {
    const result = resolve(field, ontology);
    expect(result.certainty).toBe(Certainty.KNOWN);
    expect(result.candidates[0]?.conceptKey).toBe("documents.national_id");

    const concept = ontology.byKey(result.candidates[0]?.conceptKey ?? "");
    expect(concept?.sensitivity).toBe(Sensitivity.RESTRICTED);
  });

  it("defaultPolicy requires explicit confirmation even at the matcher's own confidence", () => {
    const result = resolve(field, ontology);
    const tier = result.candidates[0]?.tier;
    expect(tier).toBeDefined();

    const request: PolicyRequest = {
      risk: ActionRisk.HIGH,
      sensitivity: Sensitivity.RESTRICTED,
      confidence: tierToConfidence(tier ?? "alias"),
      isSubmission: false,
      userConfirmed: false,
    };

    expect(defaultPolicy.evaluate(request).effect).toBe("require_confirmation");
  });

  it("defaultPolicy allows it only once the user has explicitly confirmed", () => {
    const result = resolve(field, ontology);
    const tier = result.candidates[0]?.tier;

    const request: PolicyRequest = {
      risk: ActionRisk.HIGH,
      sensitivity: Sensitivity.RESTRICTED,
      confidence: tierToConfidence(tier ?? "alias"),
      isSubmission: false,
      userConfirmed: true,
    };

    expect(defaultPolicy.evaluate(request).effect).toBe("allow");
  });
});
