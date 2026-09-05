import { describe, expect, it } from "bun:test";
import { assignFieldIds, fieldKeyOf, hashFieldKey } from "../form/field-id";

describe("hashFieldKey", () => {
  it("is deterministic for the same input", () => {
    expect(hashFieldKey("email")).toBe(hashFieldKey("email"));
  });

  it("differs for different inputs", () => {
    expect(hashFieldKey("email")).not.toBe(hashFieldKey("phone"));
  });
});

describe("fieldKeyOf", () => {
  it("prefers name over domId", () => {
    expect(fieldKeyOf("first_name", "first-name")).toBe("first_name");
  });

  it("falls back to domId when name is absent", () => {
    expect(fieldKeyOf(undefined, "first-name")).toBe("first-name");
  });

  it("is the empty string when neither is present", () => {
    expect(fieldKeyOf(undefined, undefined)).toBe("");
  });
});

describe("assignFieldIds", () => {
  it("gives the same id for the same candidate list, every time", () => {
    const candidates = [
      { formIndex: 0, name: "email" },
      { formIndex: 0, name: "phone" },
    ];

    expect(assignFieldIds(candidates)).toEqual(assignFieldIds(candidates));
  });

  it("gives distinct ids to two controls that differ only by position", () => {
    // Two anonymous controls: no name, no id. Only document order tells
    // them apart.
    const candidates = [{ formIndex: 0 }, { formIndex: 0 }];

    const [first, second] = assignFieldIds(candidates);
    expect(first).not.toBe(second);
  });

  it("does not encode the name or id in the output", () => {
    const [id] = assignFieldIds([{ formIndex: 0, name: "ssn" }]);
    expect(id).not.toContain("ssn");
  });

  it("keeps an existing field's id stable when a differently-keyed field is inserted before it", () => {
    // This is dynamic.html's step transition: a `referral` field is
    // prepended before `email` after email has already been observed once.
    const before = assignFieldIds([{ formIndex: 0, name: "email" }]);

    const after = assignFieldIds([
      { formIndex: 0, name: "referral" },
      { formIndex: 0, name: "email" },
    ]);

    expect(after[1]).toBe(before[0]);
  });

  it("disambiguates repeated keys by document order, not by an unrelated insertion", () => {
    // Two same-named radios in a group, plus an unrelated field inserted
    // between them later. Each radio's occurrence index must depend only on
    // same-name radios preceding it.
    const first = assignFieldIds([
      { formIndex: 0, name: "contact_pref" },
      { formIndex: 0, name: "contact_pref" },
    ]);

    const second = assignFieldIds([
      { formIndex: 0, name: "contact_pref" },
      { formIndex: 0, name: "unrelated" },
      { formIndex: 0, name: "contact_pref" },
    ]);

    expect(second[0]).toBe(first[0]);
    expect(second[2]).toBe(first[1]);
  });

  it("keeps forms independent: the same key in a different form yields a different id", () => {
    const [inFormZero] = assignFieldIds([{ formIndex: 0, name: "email" }]);
    const [inFormOne] = assignFieldIds([{ formIndex: 1, name: "email" }]);

    expect(inFormZero).not.toBe(inFormOne);
  });
});
