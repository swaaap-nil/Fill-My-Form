import { describe, expect, it } from "bun:test";
import { assertValidFillInstruction } from "~/core/messaging/fill-instruction";

/**
 * `docs/agent.md`'s trust pipeline puts policy on the critical path. The
 * mechanism that keeps it there is structural, not a convention: the
 * content script's `fillField` handler calls this at the top, before
 * touching the DOM, and it throws on anything the background did not
 * actually issue a decision for.
 */
describe("assertValidFillInstruction", () => {
  it("accepts a well-formed instruction", () => {
    const payload = { decisionId: "d1", fieldId: "0/abc/0", value: "Ananya" };
    expect(assertValidFillInstruction(payload)).toEqual(payload);
  });

  it("rejects a missing decisionId", () => {
    expect(() =>
      assertValidFillInstruction({ fieldId: "0/abc/0", value: "Ananya" }),
    ).toThrow();
  });

  it("rejects an empty-string decisionId", () => {
    expect(() =>
      assertValidFillInstruction({
        decisionId: "",
        fieldId: "0/abc/0",
        value: "Ananya",
      }),
    ).toThrow();
  });

  it("rejects a missing fieldId", () => {
    expect(() =>
      assertValidFillInstruction({ decisionId: "d1", value: "Ananya" }),
    ).toThrow();
  });

  it("rejects a completely unrelated payload", () => {
    expect(() => assertValidFillInstruction({ hello: "world" })).toThrow();
    expect(() => assertValidFillInstruction(null)).toThrow();
    expect(() => assertValidFillInstruction("just a string")).toThrow();
  });
});
