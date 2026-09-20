import { describe, expect, it } from "bun:test";
import { PendingDecisionRegistry } from "~/core/fill/pending-decisions";
import type { PendingDecision } from "~/core/fill/types";
import { Sensitivity } from "~/core/ontology/types";
import { ActionRisk, ConfidenceLevel } from "~/core/policy/types";

const decision = (): PendingDecision => ({
  fieldId: "field-1",
  payload: { kind: "text", value: "Ananya" },
  conceptKey: "identity.full_name",
  sensitivity: Sensitivity.PERSONAL,
  risk: ActionRisk.MEDIUM,
  confidence: ConfidenceLevel.HIGH,
});

describe("PendingDecisionRegistry", () => {
  it("returns a decision once for the tab that created it", () => {
    const registry = new PendingDecisionRegistry(1000);
    const pending = decision();

    registry.remember("decision-1", 7, pending, 100);

    expect(registry.take("decision-1", 7, 200)).toBe(pending);
    expect(registry.take("decision-1", 7, 201)).toBeNull();
  });

  it("rejects and consumes a decision confirmed from another tab", () => {
    const registry = new PendingDecisionRegistry(1000);

    registry.remember("decision-1", 7, decision(), 100);

    expect(registry.take("decision-1", 8, 200)).toBeNull();
    expect(registry.take("decision-1", 7, 201)).toBeNull();
  });

  it("expires unconfirmed decisions", () => {
    const registry = new PendingDecisionRegistry(1000);

    registry.remember("decision-1", 7, decision(), 100);

    expect(registry.take("decision-1", 7, 1100)).toBeNull();
    expect(registry.size(1100)).toBe(0);
  });

  it("clears every pending decision", () => {
    const registry = new PendingDecisionRegistry(1000);

    registry.remember("decision-1", 7, decision(), 100);
    registry.remember("decision-2", 7, decision(), 100);
    registry.clear();

    expect(registry.size(200)).toBe(0);
  });
});
