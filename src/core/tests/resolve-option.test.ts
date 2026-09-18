import { describe, expect, it } from "bun:test";
import { Certainty } from "~/core/agent/types";
import type { FormOption } from "~/core/form/types";
import { OptionMatchTier, resolveOption } from "~/core/matching/resolve-option";
import type { Concept } from "~/core/ontology/types";
import { Sensitivity, Volatility } from "~/core/ontology/types";

const concept = (valueAliases?: Record<string, string>): Concept => ({
  key: "identity.test_concept",
  label: "Test concept",
  sensitivity: Sensitivity.PERSONAL,
  volatility: Volatility.STABLE,
  expects: "select",
  aliases: {},
  valueAliases,
});

const categoryOptions: readonly FormOption[] = [
  { value: "1", label: "GEN" },
  { value: "2", label: "OBC-NCL" },
  { value: "3", label: "SC" },
  { value: "4", label: "ST" },
];

describe("resolveOption", () => {
  it("matches exactly on a normalised option label", () => {
    const result = resolveOption("GEN", categoryOptions);
    expect(result.certainty).toBe(Certainty.KNOWN);
    if (result.certainty !== Certainty.KNOWN) throw new Error("unreachable");
    expect(result.option).toEqual({ value: "1", label: "GEN" });
    expect(result.tier).toBe(OptionMatchTier.EXACT);
  });

  it("matches exactly on a normalised option value", () => {
    const result = resolveOption("2", categoryOptions);
    expect(result.certainty).toBe(Certainty.KNOWN);
    if (result.certainty !== Certainty.KNOWN) throw new Error("unreachable");
    expect(result.option.label).toBe("OBC-NCL");
  });

  it("matches an opaque-coded option by containment on the visible label", () => {
    const result = resolveOption("OBC", categoryOptions);
    expect(result.certainty).toBe(Certainty.KNOWN);
    if (result.certainty !== Certainty.KNOWN) throw new Error("unreachable");
    expect(result.option).toEqual({ value: "2", label: "OBC-NCL" });
    expect(result.tier).toBe(OptionMatchTier.CONTAINMENT);
  });

  it("resolves a demonym through the concept's valueAliases table", () => {
    const options: readonly FormOption[] = [
      { value: "IN", label: "India" },
      { value: "US", label: "United States" },
    ];
    const result = resolveOption(
      "Indian",
      options,
      concept({ indian: "india" }),
    );
    expect(result.certainty).toBe(Certainty.KNOWN);
    if (result.certainty !== Certainty.KNOWN) throw new Error("unreachable");
    expect(result.option).toEqual({ value: "IN", label: "India" });
    expect(result.tier).toBe(OptionMatchTier.VALUE_ALIAS);
  });

  it("is ambiguous when a stored value's tokens are covered by two equally specific options", () => {
    const options: readonly FormOption[] = [
      { value: "a", label: "North Zone" },
      { value: "b", label: "North Region" },
    ];
    const result = resolveOption("North", options);
    expect(result.certainty).toBe(Certainty.AMBIGUOUS);
    if (result.certainty !== Certainty.AMBIGUOUS) {
      throw new Error("unreachable");
    }
    expect(result.candidates.map((o) => o.label).sort()).toEqual([
      "North Region",
      "North Zone",
    ]);
  });

  it("is unknown when nothing matches at all", () => {
    const result = resolveOption("EWS", categoryOptions);
    expect(result.certainty).toBe(Certainty.UNKNOWN);
  });

  it("is unknown for an empty or blank stored value", () => {
    expect(resolveOption("", categoryOptions).certainty).toBe(
      Certainty.UNKNOWN,
    );
    expect(resolveOption("   ", categoryOptions).certainty).toBe(
      Certainty.UNKNOWN,
    );
  });

  it("is unknown when the field has no options at all", () => {
    expect(resolveOption("OBC", []).certainty).toBe(Certainty.UNKNOWN);
  });
});
