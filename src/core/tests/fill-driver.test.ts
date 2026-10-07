import { describe, expect, it } from "bun:test";
import { confirmDecision, planFill } from "~/core/fill/driver";
import { FieldKind, type FormField } from "~/core/form/types";
import { createInMemoryMemoryStore } from "~/core/memory/in-memory";
import {
  CURRENT_MEMORY_SCHEMA_VERSION,
  DEFAULT_PROFILE_ID,
  type FileReference,
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
  value: MemoryItem["value"],
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

  it("resolves a file concept through the same matcher and proposes metadata only", async () => {
    const ref: FileReference = {
      kind: "file_ref",
      id: "file-1",
      name: "resume.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const store = await seedMemory("documents.resume", ref);
    const result = await planFill(
      [
        field({
          label: "Upload resume",
          kind: FieldKind.FILE,
          id: "0/resume/0",
        }),
      ],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );

    const proposal = result.proposals[0];
    expect(proposal?.state).toBe("pending");
    if (proposal?.state === "pending" || proposal?.state === "restricted") {
      expect(proposal.conceptKey).toBe("documents.resume");
      expect(proposal.value).toBe("resume.pdf (2 KB)");
      expect(proposal.payload).toEqual({ kind: "file", ref });
      expect(result.decisions.get(proposal.decisionId)?.payload).toEqual({
        kind: "file",
        ref,
      });
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

describe("planFill — closed-vocabulary fields", () => {
  it("resolves a stored value to an option by containment, writing the option's value but keeping the display and memory as the label", async () => {
    const store = await seedMemory("identity.category", "OBC");
    const result = await planFill(
      [
        field({
          label: "Category",
          kind: FieldKind.RADIO,
          id: "0/cat/0",
          options: [
            { value: "1", label: "GEN" },
            { value: "2", label: "OBC-NCL" },
            { value: "3", label: "SC" },
          ],
        }),
      ],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );

    const proposal = result.proposals[0];
    expect(proposal?.state).toBe("pending");
    if (proposal?.state !== "pending" && proposal?.state !== "restricted") {
      throw new Error("unreachable");
    }
    expect(proposal.value).toBe("OBC-NCL");
    expect(proposal.payload).toEqual({ kind: "text", value: "2" });

    const decision = result.decisions.get(proposal.decisionId);
    expect(decision).toBeDefined();
    if (!decision) throw new Error("unreachable");
    expect(decision.memoryValue).toBe("OBC");

    const outcome = confirmDecision(decision, defaultPolicy);
    expect(outcome.payload).toEqual({ kind: "text", value: "2" });
    expect(outcome.memoryValue).toBe("OBC");
  });

  it("resolves a demonym through the concept's valueAliases table", async () => {
    const store = await seedMemory("identity.nationality", "Indian");
    const result = await planFill(
      [
        field({
          label: "Nationality",
          kind: FieldKind.SELECT,
          id: "0/nat/0",
          options: [
            { value: "IN", label: "India" },
            { value: "US", label: "United States" },
          ],
        }),
      ],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );

    const proposal = result.proposals[0];
    expect(proposal?.state).toBe("pending");
    if (proposal?.state !== "pending" && proposal?.state !== "restricted") {
      throw new Error("unreachable");
    }
    expect(proposal.value).toBe("India");
    expect(proposal.payload).toEqual({ kind: "text", value: "IN" });
  });

  it("proposes choose_option, one decision per option, when nothing resolves", async () => {
    const store = await seedMemory("identity.category", "General");
    const result = await planFill(
      [
        field({
          label: "Category",
          kind: FieldKind.RADIO,
          id: "0/cat/0",
          options: [
            { value: "1", label: "GEN" },
            { value: "2", label: "OBC-NCL" },
          ],
        }),
      ],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );

    const proposal = result.proposals[0];
    expect(proposal?.state).toBe("choose_option");
    if (proposal?.state !== "choose_option") throw new Error("unreachable");
    expect(proposal.storedValue).toBe("General");
    expect(proposal.choices.map((c) => c.label)).toEqual(["GEN", "OBC-NCL"]);

    for (const choice of proposal.choices) {
      const decision = result.decisions.get(choice.decisionId);
      expect(decision).toBeDefined();
    }

    const genChoice = proposal.choices.find((c) => c.label === "GEN");
    expect(genChoice).toBeDefined();
    if (!genChoice) throw new Error("unreachable");
    const decision = result.decisions.get(genChoice.decisionId);
    if (!decision) throw new Error("unreachable");

    const outcome = confirmDecision(decision, defaultPolicy);
    expect(outcome.ok).toBe(true);
    expect(outcome.payload).toEqual({ kind: "text", value: "1" });
    expect(outcome.memoryValue).toBe("GEN");
  });
});

describe("planFill — adapted and derived values", () => {
  it("fills a social username field from a canonical profile URL", async () => {
    const store = await seedMemory(
      "contact.github_url",
      "https://github.com/octocat",
    );
    const result = await planFill(
      [field({ label: "GitHub username", id: "0/gh/0" })],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );

    const proposal = result.proposals[0];
    expect(proposal?.state).toBe("pending");
    if (proposal?.state !== "pending" && proposal?.state !== "restricted") {
      throw new Error("unreachable");
    }
    expect(proposal.value).toBe("octocat");
    expect(proposal.payload).toEqual({ kind: "text", value: "octocat" });
    const decision = result.decisions.get(proposal.decisionId);
    expect(decision?.memoryWrite).toEqual({
      key: "contact.github_url",
      value: "https://github.com/octocat",
    });
  });

  it("fills a social URL field with the canonical full link", async () => {
    const store = await seedMemory("contact.github_url", "octocat");
    const result = await planFill(
      [field({ label: "GitHub profile URL", kind: FieldKind.URL, id: "gh" })],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );

    const proposal = result.proposals[0];
    expect(proposal?.state).toBe("pending");
    if (proposal?.state !== "pending" && proposal?.state !== "restricted") {
      throw new Error("unreachable");
    }
    expect(proposal.payload).toEqual({
      kind: "text",
      value: "https://github.com/octocat",
    });
  });

  it("derives age from date of birth without creating an age memory write", async () => {
    const store = await seedMemory("identity.date_of_birth", "2000-10-08");
    const result = await planFill(
      [field({ label: "Age", kind: FieldKind.NUMBER, id: "age" })],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
      () => "2026-10-07T00:00:00.000Z",
    );

    const proposal = result.proposals[0];
    expect(proposal?.state).toBe("pending");
    if (proposal?.state !== "pending" && proposal?.state !== "restricted") {
      throw new Error("unreachable");
    }
    expect(proposal.value).toContain("25");
    expect(proposal.payload).toEqual({ kind: "text", value: "25" });
    expect(result.decisions.get(proposal.decisionId)?.memoryWrite).toBe(false);
  });

  it("uses resume as a CV fallback without creating CV memory", async () => {
    const ref: FileReference = {
      kind: "file_ref",
      id: "resume-1",
      name: "resume.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const store = await seedMemory("documents.resume", ref);
    const result = await planFill(
      [field({ label: "Upload CV", kind: FieldKind.FILE, id: "cv" })],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );

    const proposal = result.proposals[0];
    expect(proposal?.state).toBe("pending");
    if (proposal?.state !== "pending" && proposal?.state !== "restricted") {
      throw new Error("unreachable");
    }
    expect(proposal.value).toContain("Resume fallback for CV");
    expect(proposal.payload).toEqual({ kind: "file", ref });
    expect(result.decisions.get(proposal.decisionId)?.memoryWrite).toBe(false);
  });

  it("derives previous experience description from the professional experience list", async () => {
    const store = await seedMemory("experience.professional.roles", [
      {
        organization: "Current Org",
        role: "Engineer",
        description: "Current work",
        startDate: "2025-01-01",
        endDate: null,
        isCurrent: true,
      },
      {
        organization: "Earlier Co",
        role: "Intern",
        description: "Built internal tools",
        startDate: "2024-01-01",
        endDate: "2024-06-01",
        isCurrent: false,
      },
    ]);
    const result = await planFill(
      [field({ label: "Experience description", id: "exp-desc" })],
      ontology,
      store,
      DEFAULT_PROFILE_ID,
      defaultPolicy,
      fixedIds,
    );

    const proposal = result.proposals[0];
    expect(proposal?.state).toBe("pending");
    if (proposal?.state !== "pending" && proposal?.state !== "restricted") {
      throw new Error("unreachable");
    }
    expect(proposal.payload).toEqual({
      kind: "text",
      value: "Built internal tools",
    });
    expect(result.decisions.get(proposal.decisionId)?.memoryWrite).toBe(false);
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
    expect(outcome.payload).toEqual({
      kind: "text",
      value: "ananya@example.com",
    });
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
