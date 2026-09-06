import { describe, expect, it } from "bun:test";
import { confirmDecision, planFill } from "~/core/fill/driver";
import { FieldKind, type FormField } from "~/core/form/types";
import { createInMemoryMemoryStore } from "~/core/memory/in-memory";
import {
  CURRENT_MEMORY_SCHEMA_VERSION,
  DEFAULT_PROFILE_ID,
  type MemoryItem,
  MemorySource,
} from "~/core/memory/types";
import { ontology } from "~/core/ontology";
import { defaultPolicy } from "~/core/policy/default";

const field = (overrides: Partial<FormField>): FormField => ({
  id: "0/test/0",
  kind: FieldKind.TEXT,
  required: false,
  hasValue: false,
  constraints: [],
  disabled: false,
  readOnly: false,
  ...overrides,
});

const seedMemory = async (
  key: string,
  value: string,
  source: MemorySource = MemorySource.USER_PROVIDED,
) => {
  const store = createInMemoryMemoryStore();
  const item: MemoryItem = {
    profileId: DEFAULT_PROFILE_ID,
    key,
    value,
    schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION,
    provenance: {
      source,
      confidence: 1,
      confirmedByUser: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
  await store.set(item);
  return store;
};

let counter = 0;
const fixedIds = () => `decision-${++counter}`;

describe("planFill", () => {
  it("proposes unknown for a field the matcher cannot resolve at all", async () => {
    const store = createInMemoryMemoryStore();
    const result = await planFill(
      [field({ label: "I accept the terms", kind: FieldKind.CHECKBOX })],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
    );

    expect(result.proposals).toEqual([
      {
        fieldId: "0/test/0",
        fieldLabel: "I accept the terms",
        state: "unknown",
      },
    ]);
    expect(result.decisions.size).toBe(0);
  });

  it("proposes ambiguous with the tied candidates, and issues no decision", async () => {
    const store = createInMemoryMemoryStore();
    const result = await planFill(
      [
        field({
          label: "Year",
          nearbyText: ["(of joining current employer)"],
        }),
      ],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
    );

    expect(result.proposals.length).toBe(1);
    const proposal = result.proposals[0];
    expect(proposal?.state).toBe("ambiguous");
    if (proposal?.state === "ambiguous") {
      expect([...proposal.candidates].sort()).toEqual(
        ["employment.current.company", "employment.current.start_year"].sort(),
      );
    }
    expect(result.decisions.size).toBe(0);
  });

  it("proposes no_value when the concept resolves but memory has nothing", async () => {
    const store = createInMemoryMemoryStore();
    const result = await planFill(
      [field({ label: "Email address", kind: FieldKind.EMAIL })],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
    );

    expect(result.proposals).toEqual([
      {
        fieldId: "0/test/0",
        fieldLabel: "Email address",
        state: "no_value",
        conceptKey: "contact.email",
      },
    ]);
    expect(result.decisions.size).toBe(0);
  });

  it("proposes pending, with a decisionId, for a resolved field with a stored value", async () => {
    const store = await seedMemory("contact.email", "ananya@example.com");
    const result = await planFill(
      [field({ label: "Email address", kind: FieldKind.EMAIL, id: "0/em/0" })],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );

    expect(result.proposals.length).toBe(1);
    const proposal = result.proposals[0];
    expect(proposal?.state).toBe("pending");
    if (proposal?.state === "pending" || proposal?.state === "restricted") {
      expect(proposal.conceptKey).toBe("contact.email");
      expect(proposal.value).toBe("ananya@example.com");
      expect(proposal.source).toBe(MemorySource.USER_PROVIDED);
      expect(result.decisions.get(proposal.decisionId)).toBeDefined();
    }
  });

  it("proposes restricted, not pending, for a restricted concept — even with a stored value", async () => {
    const store = await seedMemory("documents.national_id", "1234 5678 9012");
    const result = await planFill(
      [field({ label: "Aadhaar Number", id: "0/aad/0" })],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );

    const proposal = result.proposals[0];
    expect(proposal?.state).toBe("restricted");
  });

  it("never fills anything itself — planFill only proposes", async () => {
    const store = await seedMemory("contact.email", "ananya@example.com");
    const result = await planFill(
      [field({ label: "Email address", kind: FieldKind.EMAIL })],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );

    // No side effects beyond the returned proposals/decisions: nothing
    // about a DOM, a content script, or a fill was touched.
    expect(Object.keys(result)).toEqual(["proposals", "decisions"]);
  });
});

describe("confirmDecision", () => {
  it("allows a normal pending decision once confirmed", async () => {
    const store = await seedMemory("contact.email", "ananya@example.com");
    const { decisions } = await planFill(
      [field({ label: "Email address", kind: FieldKind.EMAIL })],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );
    const decision = [...decisions.values()][0];
    expect(decision).toBeDefined();
    if (!decision) throw new Error("unreachable");

    const outcome = confirmDecision(decision, defaultPolicy);
    expect(outcome.ok).toBe(true);
    expect(outcome.value).toBe("ananya@example.com");
  });

  it("allows a restricted decision once confirmed, exactly like a normal one", async () => {
    const store = await seedMemory("documents.national_id", "1234 5678 9012");
    const { decisions } = await planFill(
      [field({ label: "Aadhaar Number" })],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );
    const decision = [...decisions.values()][0];
    expect(decision).toBeDefined();
    if (!decision) throw new Error("unreachable");

    expect(confirmDecision(decision, defaultPolicy).ok).toBe(true);
  });
});
