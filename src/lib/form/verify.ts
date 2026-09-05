/**
 * The DOM half of `Verifier` — reads the DOM back and compares intent
 * against reality. An adapter, outside `src/core`: it is one of the few
 * places (besides `~/lib/form/fill`) allowed to touch `HTMLElement`.
 *
 * Deliberately free of any `~/lib/messaging` import, even though this file
 * only ever runs inside the content script in production: importing the
 * messaging module pulls in `wxt/browser`'s polyfill, which throws outside
 * a real extension context and would make `compareFieldValue` — the part
 * that's actually worth unit-testing — impossible to load under `bun test`.
 * `~/app/background`'s `buildLoopPorts` is the other half: its `verifier`
 * satisfies `~/core/verification/types`'s `Verifier` by sending the
 * `verifyField` message this file's content-script handler answers.
 *
 * **Never reads a `password` field.** Enforced structurally: a password
 * input is thrown on rather than silently skipped, because a caller that
 * asks to verify one has a bug worth surfacing loudly, not a case to paper
 * over.
 */

import type {
  VerificationIssue,
  VerificationResult,
} from "~/core/verification/types";
import {
  failed,
  passed,
  VerificationIssueCode,
} from "~/core/verification/types";
import type { FieldElements } from "./extract";

/**
 * Duck-typed rather than `instanceof HTMLInputElement`, deliberately: a
 * global-class `instanceof` check can only run where a DOM exists, but this
 * one guard is exactly the property `verify.test.ts` pins down with a plain
 * object, no browser required — the same reasoning `~/lib/site-access` uses
 * to keep its checks testable with a fake rather than a real `chrome.*`.
 */
export const isPasswordField = (el: unknown): boolean =>
  typeof el === "object" &&
  el !== null &&
  "type" in el &&
  (el as { type?: unknown }).type === "password";

const readValue = (el: Element): string => {
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return el.value;
  }
  // The controlled.html combobox and other ARIA widgets: not written by
  // `~/lib/form/fill` in this phase, but readable for diagnostics.
  return el.textContent?.trim() ?? "";
};

/** Digits-only or case/whitespace-insensitive equality — a masked field reformatting what was typed, not rejecting it. */
const looksNormalised = (actual: string, expected: string): boolean => {
  const digitsOnly = (s: string) => s.replace(/\D/g, "");
  if (
    digitsOnly(expected) !== "" &&
    digitsOnly(actual) === digitsOnly(expected)
  ) {
    return true;
  }
  const collapse = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return collapse(actual) === collapse(expected) && actual !== expected;
};

const issue = (
  code: VerificationIssueCode,
  message: string,
  expected: string,
  actual: string,
): VerificationIssue => ({ code, message, expected, actual });

/**
 * Pure(ish) DOM comparator: given what a fill intended and the elements it
 * targeted, decides what actually happened. Called from inside the content
 * script's `verifyField` message handler, against the same `FieldElements`
 * cache `fillField` uses (see `src/app/content/index.tsx`).
 */
export const compareFieldValue = (
  target: FieldElements | undefined,
  expectedValue: string,
): VerificationResult => {
  if (!target || Array.isArray(target)) {
    // Missing entirely, or a radio/checkbox group — grouped controls are not
    // written by `~/lib/form/fill` in this phase, so there is nothing to
    // compare a single expected value against.
    return failed([
      {
        code: VerificationIssueCode.FIELD_MISSING,
        message:
          "The field is no longer present on the page in the expected shape.",
      },
    ]);
  }

  const el = target as Element;

  if (isPasswordField(el)) {
    throw new Error(
      "compareFieldValue must never be called on a password field.",
    );
  }

  const actual = readValue(el);

  if (actual === expectedValue) return passed();

  if ("matches" in el && el.matches(":invalid")) {
    return failed([
      issue(
        VerificationIssueCode.FIELD_INVALID,
        "The page is showing its own validation error for this field.",
        expectedValue,
        actual,
      ),
    ]);
  }

  if (actual === "" && expectedValue !== "") {
    return failed([
      issue(
        VerificationIssueCode.NOT_APPLIED,
        "The field is still empty after the write.",
        expectedValue,
        actual,
      ),
    ]);
  }

  if (looksNormalised(actual, expectedValue)) {
    // Reformatting, not rejection: the write is treated as successful, with
    // the reformatting recorded for the review UI and the audit trail.
    return {
      ok: true,
      issues: [
        issue(
          VerificationIssueCode.VALUE_NORMALISED,
          "The page reformatted the value after it was written.",
          expectedValue,
          actual,
        ),
      ],
      verifiedAt: new Date().toISOString(),
    };
  }

  return failed([
    issue(
      VerificationIssueCode.VALUE_MISMATCH,
      "The field holds a different value than was written.",
      expectedValue,
      actual,
    ),
  ]);
};
