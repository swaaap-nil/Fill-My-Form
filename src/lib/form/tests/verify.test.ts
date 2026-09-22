import { describe, expect, it } from "bun:test";
import { VerificationIssueCode } from "~/core/verification/types";
import { writeFieldValue } from "~/lib/form/fill";
import { compareFieldValue } from "~/lib/form/verify";
import { docFromHtml } from "./dom-fixture";

/**
 * DOM-level coverage for `compareFieldValue`, beyond the password guard
 * already pinned in `~/lib/tests/verify.test.ts` (kept there — it needs no
 * DOM at all). See that file's own comment: the `:invalid` branch is
 * deliberately **not** repeated here. happy-dom computes `element.validity`
 * correctly but does not wire constraint-validity state into
 * `matches(":invalid")` (verified directly against this happy-dom version —
 * `validity.valid` is `false` after a pattern mismatch, but
 * `el.matches(":invalid")` still reports `false`), so a test asserting that
 * branch here would be pinning a happy-dom gap, not the real behaviour.
 * `e2e/verify.spec.ts`'s `controlled.html` cases stay the only proof of it,
 * against a real browser's real constraint validation.
 */

const formFrom = (html: string) => docFromHtml(`<form>${html}</form>`);

describe("compareFieldValue: single controls", () => {
  it("passes when the read-back value matches what was written", () => {
    const doc = formFrom(`<input id="name" name="name">`);
    const el = doc.getElementById("name") as HTMLInputElement;
    writeFieldValue(el, "Ananya Sharma");

    expect(compareFieldValue(el, "Ananya Sharma")).toEqual({
      ok: true,
      issues: [],
      verifiedAt: expect.any(String),
    });
  });

  it("reports NOT_APPLIED when the field is still empty after the write", () => {
    const doc = formFrom(`<input id="name" name="name">`);
    const el = doc.getElementById("name") as HTMLInputElement;

    const result = compareFieldValue(el, "Ananya Sharma");
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe(VerificationIssueCode.NOT_APPLIED);
  });

  it("reports VALUE_MISMATCH for an unrelated actual value", () => {
    const doc = formFrom(`<input id="name" name="name">`);
    const el = doc.getElementById("name") as HTMLInputElement;
    writeFieldValue(el, "Someone Else");

    const result = compareFieldValue(el, "Ananya Sharma");
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe(VerificationIssueCode.VALUE_MISMATCH);
  });

  it("passes as VALUE_NORMALISED, not a mismatch, when the page reformats what was written", () => {
    // Mimics controlled.html's masked-phone field: a listener that
    // reformats the value in response to the very `input` event
    // `writeFieldValue` dispatches.
    const doc = formFrom(`<input id="phone" name="phone">`);
    const el = doc.getElementById("phone") as HTMLInputElement;
    el.addEventListener("input", () => {
      const digits = el.value.replace(/\D/g, "");
      el.value = digits
        ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
        : "";
    });

    writeFieldValue(el, "9884421077");

    const result = compareFieldValue(el, "9884421077");
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: VerificationIssueCode.VALUE_NORMALISED,
        actual: "(988) 442-1077",
        expected: "9884421077",
      }),
    ]);
  });

  it("reports FIELD_MISSING when the target no longer resolves to an element", () => {
    const result = compareFieldValue(undefined, "Ananya Sharma");
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe(VerificationIssueCode.FIELD_MISSING);
  });

  it("reads a file input's file name, not its raw value", () => {
    const doc = formFrom(`<input id="resume" type="file" name="resume">`);
    const el = doc.getElementById("resume") as HTMLInputElement;
    expect(compareFieldValue(el, "resume.pdf").ok).toBe(false);
  });
});

describe("compareFieldValue: radio/checkbox groups", () => {
  it("passes a radio group when the checked member's value matches", () => {
    const doc = formFrom(`
      <input type="radio" name="contact" value="email">
      <input type="radio" name="contact" value="phone">
    `);
    const group = Array.from(doc.querySelectorAll('input[name="contact"]'));
    writeFieldValue(group, "phone");

    expect(compareFieldValue(group, "phone").ok).toBe(true);
  });

  it("passes a checkbox group when the expected value is among the checked members", () => {
    const doc = formFrom(`
      <input type="checkbox" name="hobby" value="reading">
      <input type="checkbox" name="hobby" value="sports">
    `);
    const group = Array.from(doc.querySelectorAll('input[name="hobby"]'));
    writeFieldValue(group, "sports");

    expect(compareFieldValue(group, "sports").ok).toBe(true);
    // Not exclusive like radio — checking one member does not un-verify another.
    (group[0] as HTMLInputElement).checked = true;
    expect(compareFieldValue(group, "sports").ok).toBe(true);
  });

  it("reports NOT_APPLIED for an empty group, VALUE_MISMATCH for a checked-but-wrong one", () => {
    const doc = formFrom(`
      <input type="radio" name="contact" value="email">
      <input type="radio" name="contact" value="phone">
    `);
    const group = Array.from(doc.querySelectorAll('input[name="contact"]'));

    expect(compareFieldValue(group, "phone").issues[0]?.code).toBe(
      VerificationIssueCode.NOT_APPLIED,
    );

    writeFieldValue(group, "email");
    expect(compareFieldValue(group, "phone").issues[0]?.code).toBe(
      VerificationIssueCode.VALUE_MISMATCH,
    );
  });
});
