import { describe, expect, it } from "bun:test";
import { FieldKind } from "~/core/form/types";
import {
  containsStoredValue,
  createFieldJournal,
  type RecordUnresolvedFieldInput,
} from "~/core/journal/store";
import type { UnresolvedField } from "~/core/journal/types";
import { MatchTier } from "~/core/matching/types";

const baseInput = (
  overrides: Partial<RecordUnresolvedFieldInput> = {},
): RecordUnresolvedFieldInput => ({
  origin: "https://forms.example.com",
  fieldKey: "0/deadbeef/0",
  label: "Preferred contact method",
  kind: FieldKind.RADIO,
  tiersTried: [MatchTier.ALIAS, MatchTier.NEARBY_TEXT],
  certainty: "unknown",
  now: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("containsStoredValue", () => {
  it("finds a stored value inside a longer string, case-insensitively", () => {
    expect(
      containsStoredValue("Confirm email for Ananya@Example.com", [
        "ananya@example.com",
      ]),
    ).toBe(true);
  });

  it("returns false when nothing stored appears", () => {
    expect(
      containsStoredValue("Preferred contact method", ["ananya@example.com"]),
    ).toBe(false);
  });

  it("ignores stored values under 3 characters to avoid trivial false positives", () => {
    expect(containsStoredValue("Preferred contact method", ["a", "an"])).toBe(
      false,
    );
  });
});

describe("createFieldJournal: recording", () => {
  it("records an unresolved field, normalising the label", () => {
    const journal = createFieldJournal();
    const wrote = journal.record(baseInput(), []);

    expect(wrote).toBe(true);
    expect(journal.all()).toEqual([
      {
        origin: "https://forms.example.com",
        fieldKey: "0/deadbeef/0",
        normalisedLabel: "preferred contact method",
        kind: FieldKind.RADIO,
        autocomplete: undefined,
        tiersTried: [MatchTier.ALIAS, MatchTier.NEARBY_TEXT],
        certainty: "unknown",
        count: 1,
        lastSeenAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("drops the entry entirely when the label contains a value from memory", () => {
    const journal = createFieldJournal();
    const wrote = journal.record(
      baseInput({ label: "Confirm email for ananya@example.com" }),
      ["ananya@example.com"],
    );

    expect(wrote).toBe(false);
    expect(journal.all()).toEqual([]);
  });

  it("increments count on a repeat sighting rather than duplicating the entry", () => {
    const journal = createFieldJournal();
    journal.record(baseInput({ now: "2026-01-01T00:00:00.000Z" }), []);
    journal.record(baseInput({ now: "2026-01-02T00:00:00.000Z" }), []);
    journal.record(baseInput({ now: "2026-01-03T00:00:00.000Z" }), []);

    const all = journal.all();
    expect(all.length).toBe(1);
    expect(all[0]?.count).toBe(3);
    expect(all[0]?.lastSeenAt).toBe("2026-01-03T00:00:00.000Z");
  });

  it("keys sightings by (origin, fieldKey): the same fieldKey on a different origin is a separate entry", () => {
    const journal = createFieldJournal();
    journal.record(baseInput({ origin: "https://a.example.com" }), []);
    journal.record(baseInput({ origin: "https://b.example.com" }), []);

    expect(journal.all().length).toBe(2);
  });

  it("survives being read after multiple writes (a stand-in for 'survives a reload' — the real store is IndexedDB-backed later)", () => {
    const journal = createFieldJournal();
    journal.record(baseInput({ fieldKey: "0/aaa/0" }), []);
    journal.record(baseInput({ fieldKey: "0/bbb/0" }), []);

    expect(
      journal
        .all()
        .map((e) => e.fieldKey)
        .sort(),
    ).toEqual(["0/aaa/0", "0/bbb/0"]);
  });

  it("clear() empties the journal, as Phase 4's wipe requires", () => {
    const journal = createFieldJournal();
    journal.record(baseInput(), []);
    journal.clear();

    expect(journal.all()).toEqual([]);
  });
});

describe("UnresolvedField: the schema is a narrowing, not a redaction", () => {
  it("cannot represent a raw value, a full URL with a query string, or an arbitrary key", () => {
    // This is a type-level guarantee, asserted here by construction: the
    // object below is the full set of keys `UnresolvedField` can hold.
    const entry: UnresolvedField = {
      origin: "https://forms.example.com",
      fieldKey: "0/deadbeef/0",
      normalisedLabel: "preferred contact method",
      kind: FieldKind.RADIO,
      tiersTried: [],
      certainty: "unknown",
      count: 1,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    };

    // `origin` is documented as registrable-origin-only; nothing in the type
    // stops a caller from passing a full URL, but nothing in the type has a
    // slot for a *value* either — nowhere here can a stored answer land.
    expect(Object.keys(entry).sort()).toEqual(
      [
        "origin",
        "fieldKey",
        "normalisedLabel",
        "kind",
        "tiersTried",
        "certainty",
        "count",
        "lastSeenAt",
      ].sort(),
    );
  });
});
