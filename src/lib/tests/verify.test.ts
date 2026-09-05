import { describe, expect, it } from "bun:test";
import { compareFieldValue, isPasswordField } from "~/lib/form/verify";

/**
 * `bun:test` has no DOM, so this pins down the one guard that can be — and
 * must be — proven without one: `compareFieldValue` never reads a password
 * field's value, checked with a duck-typed object rather than a real
 * `HTMLInputElement`. The rest of `compareFieldValue` (real reads, `:invalid`,
 * normalisation) needs a real DOM and is covered by `e2e/verify.spec.ts`
 * against `controlled.html`.
 */

describe("isPasswordField", () => {
  it("recognises a password-typed element", () => {
    expect(isPasswordField({ type: "password" })).toBe(true);
  });

  it("does not flag other field types", () => {
    expect(isPasswordField({ type: "text" })).toBe(false);
    expect(isPasswordField({ type: "email" })).toBe(false);
    expect(isPasswordField({})).toBe(false);
    expect(isPasswordField(null)).toBe(false);
    expect(isPasswordField("password")).toBe(false);
  });
});

describe("compareFieldValue: never reads a password field", () => {
  it("throws before reading .value, rather than silently comparing it", () => {
    const passwordField = { type: "password", value: "hunter2" };
    expect(() => compareFieldValue(passwordField as never, "hunter2")).toThrow(
      /password/i,
    );
  });
});
