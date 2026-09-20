import { describe, expect, it } from "bun:test";
import {
  assertValidFillInstruction,
  assertValidUploadInstruction,
} from "~/core/messaging/fill-instruction";

/**
 * The content script's `fillField` handler calls this at the top, before
 * touching the DOM. Policy and capability checks live in the background;
 * this test covers the DOM-side backstop against malformed write messages.
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

describe("assertValidUploadInstruction", () => {
  it("accepts a well-formed upload instruction", () => {
    expect(
      assertValidUploadInstruction({
        decisionId: "decision-1",
        fieldId: "field-1",
        uploadId: "upload-1",
      }),
    ).toEqual({
      decisionId: "decision-1",
      fieldId: "field-1",
      uploadId: "upload-1",
    });
  });

  it("rejects a missing decisionId", () => {
    expect(() =>
      assertValidUploadInstruction({
        fieldId: "field-1",
        uploadId: "upload-1",
      }),
    ).toThrow();
  });
});
