import { describe, expect, it } from "bun:test";
import { FieldKind as Kind } from "~/core/form/types";
import { extract, extractFull, MAX_FIELDS_PER_PAGE } from "~/lib/form/extract";
import { docFromHtml } from "./dom-fixture";

/**
 * Unit coverage for the DOM → `FormIR` walk, at the level `docs/testing.md`
 * asks for: no browser, a `Document` built from an inline HTML string (see
 * `dom-fixture.ts`). `e2e/extraction.spec.ts`'s committed goldens stay the
 * end-to-end regression against the real fixture pages; these tests exist
 * so a label-resolution or grouping decision can be pinned and broken in
 * milliseconds, without touching a browser.
 *
 * The header comment on `~/lib/form/extract.ts` records the decisions this
 * file is testing against. Several cases below intentionally assert
 * *current* behaviour on structures the resilience goal cares about, even
 * where that behaviour is a known gap — each is marked `KNOWN GAP` rather
 * than silently treated as correct, so a future fix has a red test waiting
 * for it instead of an untested blind spot.
 */

const fieldsOf = (html: string) =>
  extractFull(docFromHtml(html))[0]?.fields ?? [];

describe("label resolution order", () => {
  it("prefers <label for> over any other source", () => {
    // The label is deliberately not the input's immediately preceding
    // sibling, and that sibling carries different text — so this only
    // passes if `for` resolution itself ran, not by falling through to the
    // sibling-text fallback with the same answer by coincidence.
    const [field] = fieldsOf(`
      <form>
        <label for="email">Email address</label>
        <div>Different note</div>
        <input id="email" name="email" placeholder="wrong placeholder">
        <button type="submit">Apply</button>
      </form>
    `);
    expect(field?.label).toBe("Email address");
  });

  it("falls back to a wrapping <label> with no for/id", () => {
    const [field] = fieldsOf(`
      <form>
        <label>Full name<input name="name"></label>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(field?.label).toBe("Full name");
  });

  it("falls back to aria-label", () => {
    const [field] = fieldsOf(`
      <form>
        <input name="q" aria-label="Search">
        <button type="submit">Apply</button>
      </form>
    `);
    expect(field?.label).toBe("Search");
  });

  it("falls back to aria-labelledby, joining every referenced id", () => {
    const [field] = fieldsOf(`
      <form>
        <span id="a">Date of</span> <span id="b">birth</span>
        <input name="dob" aria-labelledby="a b">
        <button type="submit">Apply</button>
      </form>
    `);
    expect(field?.label).toBe("Date of birth");
  });

  it("falls back to preceding sibling text within the same parent", () => {
    const [field] = fieldsOf(`
      <form>
        <div class="row">
          <div>Employee ID</div>
          <input name="fld_1">
        </div>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(field?.label).toBe("Employee ID");
  });

  it("falls back to placeholder as the last resort", () => {
    const [field] = fieldsOf(`
      <form>
        <input name="q" placeholder="Search products">
        <button type="submit">Apply</button>
      </form>
    `);
    expect(field?.label).toBe("Search products");
  });

  it("ignores generic file-picker chrome text ('Choose file', 'Browse')", () => {
    const [field] = fieldsOf(`
      <form>
        <div>Choose File<input type="file" id="resume" name="resume"></div>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(field?.label).toBeUndefined();
  });
});

describe("table-layout forms", () => {
  it("resolves a label from the preceding table cell, walking up through ancestors", () => {
    const fields = fieldsOf(`
      <form>
        <table>
          <tr><td>First name</td><td><input name="fname"></td></tr>
          <tr><td>Last name</td><td><input name="lname"></td></tr>
        </table>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields.map((f) => f.label)).toEqual(["First name", "Last name"]);
  });
});

describe("opaque / generated names", () => {
  it("still resolves a label via adjacent text when the name is meaningless", () => {
    const [field] = fieldsOf(`
      <form>
        <div class="row">
          <div>10th Passing Year</div>
          <input name="fld_7">
        </div>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(field?.label).toBe("10th Passing Year");
    expect(field?.id).not.toContain("fld_7");
  });

  it("disambiguates two nameless, idless controls by document order, not identity", () => {
    const fields = fieldsOf(`
      <form>
        <input>
        <input>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields).toHaveLength(2);
    expect(fields[0]?.id).not.toBe(fields[1]?.id);
    // Same (formIndex, key) pair — only the trailing occurrence index differs.
    expect(fields[0]?.id?.replace(/\/\d+$/, "")).toBe(
      fields[1]?.id?.replace(/\/\d+$/, ""),
    );
  });

  it("does not shift an existing field's occurrence when a differently-keyed field is inserted before it", () => {
    const idOfA = (html: string) =>
      fieldsOf(html).find((f) => f.name === "a")?.id;

    const before = idOfA(`
      <form><input name="a"><button type="submit">Apply</button></form>
    `);
    // dynamic.html's step-transition shape: an unrelated field ("b") shows
    // up ahead of "a" in document order. "a"'s own occurrence count (the
    // only thing its id depends on, beyond formIndex/key) is unaffected.
    const after = idOfA(`
      <form><input name="b"><input name="a"><button type="submit">Apply</button></form>
    `);
    expect(before).toBe(after);
  });
});

describe("radio and checkbox grouping", () => {
  it("groups same-name radios into one field with options, not one field per control", () => {
    const fields = fieldsOf(`
      <form>
        <fieldset>
          <legend>Preferred contact method</legend>
          <label><input type="radio" name="contact" value="email">Email</label>
          <label><input type="radio" name="contact" value="phone">Phone</label>
        </fieldset>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.kind).toBe(Kind.RADIO);
    expect(fields[0]?.label).toBe("Preferred contact method");
    expect(fields[0]?.options?.map((o) => o.value)).toEqual(["email", "phone"]);
  });

  it("resolves a fieldset-grouped label from the <legend>, not the first option's own label", () => {
    const fields = fieldsOf(`
      <form>
        <fieldset>
          <legend>How did you hear about us?</legend>
          <label><input type="radio" name="referral" value="friend">A friend</label>
        </fieldset>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields[0]?.label).toBe("How did you hear about us?");
  });

  it("KNOWN GAP: a radio group with no fieldset and no wrapping-label question text falls back to the first option's own label", () => {
    // The common, no-fieldset shape: a plain question line, then labelled
    // radio options. `resolveUnfieldedGroupLabel` only looks for a
    // `[role=radiogroup]`/`[role=group]` ancestor or an unrelated `<label>`
    // inside the group's common ancestor — a bare `<p>`/`<div>` question is
    // never considered, so the group mislabels itself as its first option.
    // Real-page resilience work should either widen this search or route
    // such groups through the same ambiguity path as a field with no label.
    const fields = fieldsOf(`
      <form>
        <div>
          <p>Preferred contact method</p>
          <label><input type="radio" name="contact" value="email">Email</label>
          <label><input type="radio" name="contact" value="phone">Phone</label>
        </div>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields[0]?.label).toBe("Email");
  });

  it("keeps a lone checkbox as a single boolean field, not a group", () => {
    const fields = fieldsOf(`
      <form>
        <label><input type="checkbox" name="terms">I accept</label>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.options).toBeUndefined();
  });

  it("groups checkboxes sharing a name once there is more than one", () => {
    const fields = fieldsOf(`
      <form>
        <label><input type="checkbox" name="hobby" value="reading">Reading</label>
        <label><input type="checkbox" name="hobby" value="sports">Sports</label>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.kind).toBe(Kind.CHECKBOX);
    expect(fields[0]?.options?.map((o) => o.value)).toEqual([
      "reading",
      "sports",
    ]);
  });
});

describe("ARIA custom widgets", () => {
  it("extracts a role=combobox as an unknown-kind field with its listbox options attached", () => {
    const fields = fieldsOf(`
      <form>
        <label id="country-label">Country</label>
        <div role="combobox" aria-labelledby="country-label" aria-controls="country-listbox">India</div>
        <ul id="country-listbox">
          <li role="option" data-value="IN">India</li>
          <li role="option" data-value="US">United States</li>
        </ul>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.kind).toBe(Kind.UNKNOWN);
    expect(fields[0]?.label).toBe("Country");
    expect(fields[0]?.options?.map((o) => o.value)).toEqual(["IN", "US"]);
  });
});

describe("skip list: never candidates", () => {
  it("never treats a hidden csrf token as a candidate field", () => {
    const fields = fieldsOf(`
      <form>
        <input type="hidden" name="csrf" value="abc123">
        <input name="name">
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields.map((f) => f.name)).toEqual(["name"]);
  });

  it("never treats a password field as a candidate", () => {
    const fields = fieldsOf(`
      <form>
        <input type="password" name="pw">
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields).toHaveLength(0);
  });

  it("skips disabled and readonly controls", () => {
    const fields = fieldsOf(`
      <form>
        <input name="a" disabled>
        <input name="b" readonly>
        <input name="c">
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields.map((f) => f.name)).toEqual(["c"]);
  });

  it("skips a zero-size element (the isInvisible geometry check)", () => {
    const fields = fieldsOf(`
      <form>
        <input name="a" style="width:0;height:0">
        <input name="b">
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields.map((f) => f.name)).toEqual(["b"]);
  });

  it("skips an element under a [hidden] ancestor", () => {
    const fields = fieldsOf(`
      <form>
        <div hidden><input name="a"></div>
        <input name="b">
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields.map((f) => f.name)).toEqual(["b"]);
  });

  it("skips a nameless, idless, unlabelled file input (no reliable identity)", () => {
    const fields = fieldsOf(`
      <form>
        <input type="file">
        <input name="b">
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields.map((f) => f.name)).toEqual(["b"]);
  });
});

describe("structures not currently reached at all", () => {
  it("KNOWN GAP: a field inside an open shadow root is invisible to extraction", () => {
    // querySelectorAll never pierces a shadow boundary, and extract.ts does
    // not walk shadow roots explicitly. A web-component-built form (common
    // on modern ATS/career sites) contributes zero fields today.
    const doc = docFromHtml(`
      <form><div id="host"></div><button type="submit">Apply</button></form>
    `);
    const host = doc.getElementById("host") as HTMLElement & {
      attachShadow: (init: { mode: "open" }) => {
        innerHTML: string;
      };
    };
    host.attachShadow({ mode: "open" }).innerHTML =
      '<label>Email<input name="email"></label>';

    expect(extractFull(doc)[0]?.fields ?? []).toHaveLength(0);
  });

  it("KNOWN GAP: a contenteditable region is never a candidate field", () => {
    // isFormControl only recognises input/select/textarea. A rich-text
    // "cover note" built on a contenteditable div (or any ARIA
    // textbox-by-role widget without role=combobox) is silently skipped
    // rather than surfaced as an unknown field the way the combobox case is.
    const fields = fieldsOf(`
      <form>
        <label id="l">Cover note</label>
        <div contenteditable="true" role="textbox" aria-labelledby="l"></div>
        <button type="submit">Apply</button>
      </form>
    `);
    expect(fields).toHaveLength(0);
  });
});

describe("upload intents", () => {
  it("recognises an upload control's requirements text and parses its constraints", () => {
    const intents = extractFull(
      docFromHtml(`
        <form>
          <div>
            <label>Upload resume<input type="file" name="resume" accept=".pdf"></label>
            <p>PDF only, file size between 200KB and 2MB.</p>
          </div>
          <button type="submit">Apply</button>
        </form>
      `),
    )[0]?.uploadIntents;

    expect(intents).toHaveLength(1);
    expect(intents?.[0]).toMatchObject({
      kind: "document",
      label: "Upload resume",
      hasNativeTarget: true,
      constraints: [
        { kind: "accept", value: [".pdf"] },
        {
          kind: "fileSizeRangeBytes",
          value: { min: 200 * 1024, max: 2 * 1024 * 1024 },
        },
      ],
    });
  });
});

describe("nearbyText boundaries", () => {
  it("does not leak an unrelated field's boundary text (a following <fieldset>) into nearbyText", () => {
    const fields = fieldsOf(`
      <form>
        <textarea name="note"></textarea>
        <fieldset>
          <legend>Preferred contact method</legend>
          <label><input type="radio" name="contact" value="email">Email</label>
        </fieldset>
        <button type="submit">Apply</button>
      </form>
    `);
    const note = fields.find((f) => f.name === "note");
    expect(note?.nearbyText ?? []).not.toContain("Preferred contact method");
  });
});

describe("per-page field cap", () => {
  it("is 300 — generous headroom over a real form, bounded against a pathological one", () => {
    expect(MAX_FIELDS_PER_PAGE).toBe(300);
  });

  it("stops collecting candidates at the cap, not just truncating the report", () => {
    const inputs = Array.from(
      { length: MAX_FIELDS_PER_PAGE + 5 },
      (_, i) => `<input name="f${i}">`,
    ).join("");
    const fields = fieldsOf(
      `<form>${inputs}<button type="submit">Apply</button></form>`,
    );
    expect(fields).toHaveLength(MAX_FIELDS_PER_PAGE);
  });
});

describe("extract() (the cheap PageObservation)", () => {
  it("projects to FieldSummary — no nearbyText, options or constraints leak through", () => {
    const doc = docFromHtml(`
      <form>
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" required>
        <button type="submit">Apply</button>
      </form>
    `);
    const [summary] = extract(doc).forms[0]?.fields ?? [];
    expect(summary).toEqual({
      id: expect.any(String),
      kind: Kind.EMAIL,
      label: "Email address",
      required: true,
      hasValue: false,
    });
  });

  it("never reports hasValue from what the user typed — filled text still shows as text, not the value itself", () => {
    const doc = docFromHtml(`
      <form>
        <input name="ssn" value="123-45-6789">
        <button type="submit">Apply</button>
      </form>
    `);
    const observation = JSON.stringify(extract(doc));
    expect(observation).not.toContain("123-45-6789");
    expect(extract(doc).forms[0]?.fields[0]?.hasValue).toBe(true);
  });
});
