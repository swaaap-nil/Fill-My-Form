import { describe, expect, it } from "bun:test";
import { uploadFieldFile, writeFieldValue } from "~/lib/form/fill";
import { docFromHtml } from "./dom-fixture";

/**
 * Unit coverage for the DOM write half of the fill step, per
 * `docs/testing.md`: build a small `Document` with happy-dom rather than
 * relying only on `e2e/verify.spec.ts` and `e2e/files.spec.ts` driving a
 * real browser against `controlled.html`. The native-setter-plus-event
 * technique itself (the reason a plain `el.value =` is not enough for a
 * React-controlled input) is *not* re-proven here — happy-dom has no
 * framework mounted on top of it to drop a naive write, so there is nothing
 * for that case to distinguish itself against. `controlled.html`'s
 * `#react-name` stays the one test that proves the technique against a real
 * framework; what these tests pin is `writeFieldValue`'s own dispatch logic:
 * which element shapes it accepts, which it correctly refuses, and that the
 * write actually lands and fires events a listener can observe.
 */

const formFrom = (html: string) => docFromHtml(`<form>${html}</form>`);

describe("writeFieldValue: single controls", () => {
  it("writes a text input via the native setter and fires input+change", () => {
    const doc = formFrom(`<input id="name" name="name">`);
    const el = doc.getElementById("name") as HTMLInputElement;
    const events: string[] = [];
    el.addEventListener("input", () => events.push("input"));
    el.addEventListener("change", () => events.push("change"));

    expect(writeFieldValue(el, "Ananya Sharma")).toBe(true);
    expect(el.value).toBe("Ananya Sharma");
    expect(events).toEqual(["input", "change"]);
  });

  it("writes a textarea", () => {
    const doc = formFrom(`<textarea id="bio" name="bio"></textarea>`);
    const el = doc.getElementById("bio") as HTMLTextAreaElement;
    expect(writeFieldValue(el, "A short bio.")).toBe(true);
    expect(el.value).toBe("A short bio.");
  });

  it("writes a <select> when the value matches a real option", () => {
    const doc = formFrom(
      `<select id="country" name="country"><option value="">-</option><option value="IN">India</option></select>`,
    );
    const el = doc.getElementById("country") as HTMLSelectElement;
    expect(writeFieldValue(el, "IN")).toBe(true);
    expect(el.value).toBe("IN");
  });

  it("refuses a <select> value that is not one of its real options", () => {
    // The value is resolved against real options upstream
    // (`~/core/matching/resolve-option`); this is the guard against that
    // contract being violated, not the normal path.
    const doc = formFrom(
      `<select id="country" name="country"><option value="">-</option><option value="IN">India</option></select>`,
    );
    const el = doc.getElementById("country") as HTMLSelectElement;
    expect(writeFieldValue(el, "US")).toBe(false);
    expect(el.value).toBe("");
  });

  it("refuses a field kind outside the documented scope (a button)", () => {
    const doc = formFrom(`<input id="go" type="button" value="Go">`);
    const el = doc.getElementById("go") as HTMLInputElement;
    expect(writeFieldValue(el, "Something")).toBe(false);
  });

  it("refuses a single checkbox — not part of writeFieldValue's scope", () => {
    const doc = formFrom(`<input id="terms" type="checkbox" name="terms">`);
    const el = doc.getElementById("terms") as HTMLInputElement;
    expect(writeFieldValue(el, "true")).toBe(false);
  });
});

describe("writeFieldValue: radio/checkbox groups", () => {
  it("checks the member whose value matches, unchecking the rest (native radio semantics)", () => {
    const doc = formFrom(`
      <label><input type="radio" name="contact" value="email">Email</label>
      <label><input type="radio" name="contact" value="phone">Phone</label>
    `);
    const group = Array.from(doc.querySelectorAll('input[name="contact"]'));
    (group[0] as HTMLInputElement).checked = true;

    expect(writeFieldValue(group, "phone")).toBe(true);
    expect((group[0] as HTMLInputElement).checked).toBe(false);
    expect((group[1] as HTMLInputElement).checked).toBe(true);
  });

  it("checks a matching checkbox in a group without touching its siblings", () => {
    const doc = formFrom(`
      <label><input type="checkbox" name="hobby" value="reading">Reading</label>
      <label><input type="checkbox" name="hobby" value="sports">Sports</label>
    `);
    const group = Array.from(doc.querySelectorAll('input[name="hobby"]'));

    expect(writeFieldValue(group, "sports")).toBe(true);
    expect((group[0] as HTMLInputElement).checked).toBe(false);
    expect((group[1] as HTMLInputElement).checked).toBe(true);
  });

  it("returns false when no member's value matches", () => {
    const doc = formFrom(`
      <label><input type="radio" name="contact" value="email">Email</label>
    `);
    const group = Array.from(doc.querySelectorAll('input[name="contact"]'));
    expect(writeFieldValue(group, "phone")).toBe(false);
  });
});

describe("uploadFieldFile", () => {
  it("attaches a file to a file input via DataTransfer and fires input+change", () => {
    const doc = formFrom(`<input id="resume" type="file" name="resume">`);
    const el = doc.getElementById("resume") as HTMLInputElement;
    const events: string[] = [];
    el.addEventListener("input", () => events.push("input"));
    el.addEventListener("change", () => events.push("change"));

    const ok = uploadFieldFile(el, {
      name: "resume.pdf",
      mimeType: "application/pdf",
      bytes: [1, 2, 3],
    });

    expect(ok).toBe(true);
    expect(el.files?.[0]?.name).toBe("resume.pdf");
    expect(events).toEqual(["input", "change"]);
  });

  it("refuses a target that is not a file input", () => {
    const doc = formFrom(`<input id="txt" name="txt">`);
    const el = doc.getElementById("txt") as HTMLInputElement;
    expect(
      uploadFieldFile(el, {
        name: "resume.pdf",
        mimeType: "application/pdf",
        bytes: [1],
      }),
    ).toBe(false);
  });

  it("refuses a group target — uploads are never resolved to an option group", () => {
    const doc = formFrom(`<input type="radio" name="contact" value="email">`);
    const group = Array.from(doc.querySelectorAll('input[name="contact"]'));
    expect(
      uploadFieldFile(group, {
        name: "resume.pdf",
        mimeType: "application/pdf",
        bytes: [1],
      }),
    ).toBe(false);
  });
});
