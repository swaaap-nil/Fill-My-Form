import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  answerQuestion,
  confirmReview,
  createRun,
  drive,
  FILL_FIELD_TOOL,
  INSPECT_FORM_TOOL,
  type LoopPorts,
  type RunSnapshot,
  step,
  UPLOAD_FILE_TOOL,
} from "~/core/agent/loop";
import { AgentPhase, AgentStatus } from "~/core/agent/types";
import type { FormField } from "~/core/form/types";
import { nullLogger } from "~/core/logging";
import { createInMemoryMemoryStore } from "~/core/memory/in-memory";
import {
  DEFAULT_PROFILE_ID,
  type FileReference,
  MemorySource,
} from "~/core/memory/types";
import { recordAnswer } from "~/core/memory/write-service";
import { ontology } from "~/core/ontology";
import { defaultPolicy } from "~/core/policy/default";
import {
  ActionRisk,
  PolicyEffect,
  type PolicyEngine,
} from "~/core/policy/types";
import { createToolRegistry } from "~/core/tools/registry";
import { CapabilityDomain } from "~/core/tools/types";
import type { Verifier } from "~/core/verification/types";
import {
  failed,
  passed,
  VerificationIssueCode,
} from "~/core/verification/types";

/**
 * A tiny fake "page": a mutable field list plus a mutable value map. Both
 * the fake `inspect_form`/`fill_field` tools and the fake `Verifier` share
 * it, so a test can assert on `page.values` exactly like an e2e test would
 * assert on the real DOM, without a browser.
 */
interface FakePage {
  fields: FormField[];
  values: Record<string, string>;
}

const makeField = (
  overrides: Partial<FormField> & { id: string },
): FormField => ({
  kind: "text",
  required: false,
  hasValue: false,
  constraints: [],
  disabled: false,
  readOnly: false,
  ...overrides,
});

const inspectFormTool = (page: FakePage) => ({
  name: INSPECT_FORM_TOOL,
  domain: CapabilityDomain.BROWSER,
  description: "test double",
  input: z.unknown(),
  output: z.unknown(),
  risk: ActionRisk.LOW,
  execute: async () => ({
    forms: [
      {
        id: "0",
        fields: page.fields.map((field) => ({
          ...field,
          hasValue: Boolean(page.values[field.id]),
        })),
      },
    ],
  }),
});

const fillFieldInput = z.object({ fieldId: z.string(), value: z.string() });

const fillFieldTool = (page: FakePage) => ({
  name: FILL_FIELD_TOOL,
  domain: CapabilityDomain.BROWSER,
  description: "test double",
  input: fillFieldInput,
  output: z.object({ ok: z.boolean() }),
  risk: ActionRisk.MEDIUM,
  execute: async (input: z.infer<typeof fillFieldInput>) => {
    page.values[input.fieldId] = input.value;
    return { ok: true };
  },
});

const uploadFileInput = z.object({
  fieldId: z.string(),
  ref: z.object({
    kind: z.literal("file_ref"),
    id: z.string(),
    name: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
    createdAt: z.string(),
  }),
  constraints: z.array(z.unknown()),
});

const uploadFileTool = (page: FakePage) => ({
  name: UPLOAD_FILE_TOOL,
  domain: CapabilityDomain.FILES,
  description: "test double",
  input: uploadFileInput,
  output: z.object({ ok: z.boolean() }),
  risk: ActionRisk.MEDIUM,
  execute: async (input: z.infer<typeof uploadFileInput>) => {
    page.values[input.fieldId] = input.ref.name;
    return { ok: true };
  },
});

const fakeVerifier = (page: FakePage): Verifier => ({
  verify: async ({ fieldId, expectedValue }) => {
    const actual = page.values[fieldId] ?? "";
    if (actual === expectedValue) return passed();
    if (actual === "" && expectedValue !== "") {
      return failed([
        { code: VerificationIssueCode.NOT_APPLIED, message: "field is empty" },
      ]);
    }
    return failed([
      { code: VerificationIssueCode.VALUE_MISMATCH, message: "value differs" },
    ]);
  },
});

const fakeClock = () => {
  let n = 0;
  return () => new Date(2026, 0, 1, 0, 0, ++n).toISOString();
};

const fakeIdGen = () => {
  let n = 0;
  return () => `id-${++n}`;
};

const alwaysAllow: PolicyEngine = {
  evaluate: () => ({
    effect: PolicyEffect.ALLOW,
    reason: "test: always allow",
  }),
};

const buildPorts = (page: FakePage, policy: PolicyEngine): LoopPorts => {
  const tools = createToolRegistry();
  tools.register(inspectFormTool(page));
  tools.register(fillFieldTool(page));
  tools.register(uploadFileTool(page));

  return {
    tools,
    policy,
    memory: createInMemoryMemoryStore(),
    ontology,
    verifier: fakeVerifier(page),
    files: {
      prepareForUpload: async (ref) => ({
        ok: true,
        upload: {
          ref,
          payload: {
            name: ref.name,
            mimeType: ref.mimeType,
            sizeBytes: ref.sizeBytes,
          },
          transformed: false,
          originalSizeBytes: ref.sizeBytes,
        },
      }),
    },
    profileId: DEFAULT_PROFILE_ID,
    clock: fakeClock(),
    generateId: fakeIdGen(),
    logger: nullLogger,
  };
};

const EMAIL_FIELD = makeField({
  id: "f1",
  autocomplete: "email",
  label: "Email address",
});

describe("loop: a known field policy allows automatically", () => {
  it("fills it with no pause", async () => {
    const page: FakePage = { fields: [EMAIL_FIELD], values: {} };
    const ports = buildPorts(page, alwaysAllow);
    await recordAnswer(ports.memory, {
      profileId: DEFAULT_PROFILE_ID,
      key: "contact.email",
      value: "ananya@example.com",
      source: MemorySource.USER_PROVIDED,
      now: ports.clock(),
    });

    let snapshot = createRun(ports, "https://example.com", 1);
    snapshot = await drive(snapshot, ports);

    expect(snapshot.run.state.status).toBe(AgentStatus.COMPLETED);
    expect(page.values.f1).toBe("ananya@example.com");
  });
});

describe("loop: file references use the generic compliance/upload adapters", () => {
  it("prepares a compliant copy and uploads by file metadata, leaving the reference untouched", async () => {
    const resumeRef: FileReference = {
      kind: "file_ref",
      id: "resume-1",
      name: "resume.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const seenConstraints: unknown[] = [];
    const page: FakePage = {
      fields: [
        makeField({
          id: "resume",
          kind: "file",
          label: "Upload resume",
          constraints: [
            { kind: "accept", value: [".pdf", "application/pdf"] },
            { kind: "maxFileSizeBytes", value: 1024 },
          ],
        }),
      ],
      values: {},
    };
    const ports = buildPorts(page, alwaysAllow);
    const customPorts: LoopPorts = {
      ...ports,
      files: {
        prepareForUpload: async (ref, constraints) => {
          seenConstraints.push(...constraints);
          return {
            ok: true,
            upload: {
              ref,
              payload: {
                name: ref.name,
                mimeType: ref.mimeType,
                sizeBytes: 512,
              },
              transformed: true,
              originalSizeBytes: ref.sizeBytes,
            },
          };
        },
      },
    };
    await recordAnswer(customPorts.memory, {
      profileId: DEFAULT_PROFILE_ID,
      key: "documents.resume",
      value: resumeRef,
      source: MemorySource.USER_PROVIDED,
      now: customPorts.clock(),
    });

    let snapshot = createRun(customPorts, "https://example.com", 1);
    snapshot = await drive(snapshot, customPorts);

    expect(snapshot.run.state.status).toBe(AgentStatus.COMPLETED);
    expect(page.values.resume).toBe("resume.pdf");
    expect(seenConstraints).toContainEqual({
      kind: "maxFileSizeBytes",
      value: 1024,
    });
    expect(resumeRef.sizeBytes).toBe(2048);
  });
});

describe("loop: a fill_field tool call that succeeds but writes nothing", () => {
  it("does not treat an { ok: false } result as a clean write", async () => {
    // Mirrors the controlled.html combobox: the message round-trip succeeds
    // (no thrown error, valid schema), but the underlying `writeFieldValue`
    // call reports `ok: false` because the control can't be written that
    // way. The field is given up on (via VERIFY's NOT_APPLIED and PLAN's
    // retry cap) rather than the run silently believing it wrote something,
    // and rather than one unfillable field failing the whole run.
    const page: FakePage = { fields: [EMAIL_FIELD], values: {} };
    const tools = createToolRegistry();
    tools.register(inspectFormTool(page));
    tools.register({
      name: FILL_FIELD_TOOL,
      domain: CapabilityDomain.BROWSER,
      description: "test double: never actually writes",
      input: fillFieldInput,
      output: z.object({ ok: z.boolean() }),
      risk: ActionRisk.MEDIUM,
      execute: async () => ({ ok: false }),
    });

    const ports: LoopPorts = {
      tools,
      policy: alwaysAllow,
      memory: createInMemoryMemoryStore(),
      ontology,
      verifier: fakeVerifier(page),
      profileId: DEFAULT_PROFILE_ID,
      clock: fakeClock(),
      generateId: fakeIdGen(),
      logger: nullLogger,
    };
    await recordAnswer(ports.memory, {
      profileId: DEFAULT_PROFILE_ID,
      key: "contact.email",
      value: "ananya@example.com",
      source: MemorySource.USER_PROVIDED,
      now: ports.clock(),
    });

    let snapshot = createRun(ports, "https://example.com", 1);
    snapshot = await drive(snapshot, ports);

    expect(snapshot.run.state.status).toBe(AgentStatus.COMPLETED);
    expect(page.values.f1).toBeUndefined();
    expect(snapshot.handled).toContain("f1");
    // The pipeline itself succeeded every time (no thrown error) — it is
    // the field-level verification that caught nothing being written.
    const actedSteps = snapshot.run.steps.filter(
      (s) => s.toolName === FILL_FIELD_TOOL,
    );
    expect(actedSteps.length).toBeGreaterThan(0);
    expect(actedSteps.every((s) => s.ok === true)).toBe(true);
    const verifySteps = snapshot.run.steps.filter(
      (s) => s.phase === "plan" && s.ok === false,
    );
    expect(verifySteps.length).toBeGreaterThan(0);
  });
});

describe("loop: the request_review round trip (defaultPolicy)", () => {
  const setup = async () => {
    const page: FakePage = { fields: [EMAIL_FIELD], values: {} };
    const ports = buildPorts(page, defaultPolicy);
    await recordAnswer(ports.memory, {
      profileId: DEFAULT_PROFILE_ID,
      key: "contact.email",
      value: "ananya@example.com",
      source: MemorySource.USER_PROVIDED,
      now: ports.clock(),
    });
    let snapshot = createRun(ports, "https://example.com", 1);
    snapshot = await drive(snapshot, ports);
    return { page, ports, snapshot };
  };

  it("pauses for review without writing anything yet", async () => {
    const { page, snapshot } = await setup();
    expect(snapshot.run.state.status).toBe(AgentStatus.WAITING_FOR_USER);
    expect(snapshot.run.state.pendingQuestion).toContain("Email address");
    expect(page.values.f1).toBeUndefined();
  });

  it("writes the value once approved", async () => {
    const { page, ports, snapshot } = await setup();
    let next = confirmReview(snapshot, ports, true);
    next = await drive(next, ports);

    expect(next.run.state.status).toBe(AgentStatus.COMPLETED);
    expect(page.values.f1).toBe("ananya@example.com");
  });

  it("refreshes a stale value's horizon from the approval time", async () => {
    const page: FakePage = {
      fields: [makeField({ id: "f1", label: "Current employer" })],
      values: {},
    };
    const ports: LoopPorts = {
      ...buildPorts(page, defaultPolicy),
      clock: () => "2026-01-01T00:00:00.000Z",
    };
    await recordAnswer(ports.memory, {
      profileId: DEFAULT_PROFILE_ID,
      key: "employment.current.company",
      value: "Kirloskar Systems",
      source: MemorySource.USER_PROVIDED,
      now: "2025-01-01T00:00:00.000Z",
      expiresAt: "2025-07-01T00:00:00.000Z",
      freshnessRule: "volatile:P6M",
    });

    let snapshot = createRun(ports, "https://example.com", 1);
    snapshot = await drive(snapshot, ports);
    expect(snapshot.run.state.status).toBe(AgentStatus.WAITING_FOR_USER);

    snapshot = confirmReview(snapshot, ports, true);
    snapshot = await drive(snapshot, ports);

    expect(page.values.f1).toBe("Kirloskar Systems");
    const stored = await ports.memory.get(
      DEFAULT_PROFILE_ID,
      "employment.current.company",
    );
    expect(stored?.provenance.expiresAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("leaves the field empty when declined, and still completes", async () => {
    const { page, ports, snapshot } = await setup();
    let next = confirmReview(snapshot, ports, false);
    next = await drive(next, ports);

    expect(next.run.state.status).toBe(AgentStatus.COMPLETED);
    expect(page.values.f1).toBeUndefined();
  });
});

describe("loop: ask_user for a known concept with no stored value", () => {
  it("asks, records the answer to memory, and fills the field once answered", async () => {
    const page: FakePage = { fields: [EMAIL_FIELD], values: {} };
    const ports = buildPorts(page, defaultPolicy);

    let snapshot = createRun(ports, "https://example.com", 1);
    snapshot = await drive(snapshot, ports);

    expect(snapshot.run.state.status).toBe(AgentStatus.WAITING_FOR_USER);
    expect(snapshot.run.state.pendingQuestion).toContain("Email address");

    snapshot = await answerQuestion(snapshot, ports, "typed@example.com");
    snapshot = await drive(snapshot, ports);

    expect(snapshot.run.state.status).toBe(AgentStatus.COMPLETED);
    expect(page.values.f1).toBe("typed@example.com");

    const stored = await ports.memory.get(DEFAULT_PROFILE_ID, "contact.email");
    expect(stored?.value).toBe("typed@example.com");
  });

  it("reuses one typed answer for same-concept confirmation fields in the same run", async () => {
    const page: FakePage = {
      fields: [
        makeField({ id: "f1", label: "First name" }),
        makeField({ id: "f2", label: "Confirm first name" }),
      ],
      values: {},
    };
    const ports = buildPorts(page, defaultPolicy);

    let snapshot = createRun(ports, "https://example.com", 1);
    snapshot = await drive(snapshot, ports);

    expect(snapshot.run.state.status).toBe(AgentStatus.WAITING_FOR_USER);
    expect(snapshot.run.state.pendingQuestion).toContain("First name");

    snapshot = await answerQuestion(snapshot, ports, "Ananya");
    snapshot = await drive(snapshot, ports);

    expect(snapshot.run.state.status).toBe(AgentStatus.COMPLETED);
    expect(page.values.f1).toBe("Ananya");
    expect(page.values.f2).toBe("Ananya");

    const askSteps = snapshot.run.steps.filter(
      (step) => step.decision?.action.type === "ask_user",
    );
    expect(askSteps).toHaveLength(1);
  });

  it("asks for a file reference and uploads it once answered", async () => {
    const resumeRef: FileReference = {
      kind: "file_ref",
      id: "resume-answer",
      name: "resume.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const page: FakePage = {
      fields: [
        makeField({
          id: "resume",
          kind: "file",
          label: "Upload resume",
          constraints: [{ kind: "accept", value: [".pdf"] }],
        }),
      ],
      values: {},
    };
    const ports = buildPorts(page, alwaysAllow);

    let snapshot = createRun(ports, "https://example.com", 1);
    snapshot = await drive(snapshot, ports);

    expect(snapshot.run.state.status).toBe(AgentStatus.WAITING_FOR_USER);
    expect(snapshot.run.state.pendingQuestion).toContain("Upload resume");

    snapshot = await answerQuestion(snapshot, ports, resumeRef);
    snapshot = await drive(snapshot, ports);

    expect(snapshot.run.state.status).toBe(AgentStatus.COMPLETED);
    expect(page.values.resume).toBe("resume.pdf");

    const stored = await ports.memory.get(
      DEFAULT_PROFILE_ID,
      "documents.resume",
    );
    expect(stored?.value).toEqual(resumeRef);
  });
});

describe("loop: unknown/ambiguous fields are skipped, never asked about", () => {
  it("completes without ever pausing", async () => {
    const mystery = makeField({ id: "f2", label: "Favourite colour" });
    const page: FakePage = { fields: [mystery], values: {} };
    const ports = buildPorts(page, defaultPolicy);

    let snapshot = createRun(ports, "https://example.com", 1);
    snapshot = await drive(snapshot, ports);

    expect(snapshot.run.state.status).toBe(AgentStatus.COMPLETED);
    expect(snapshot.handled).toContain("f2");
  });
});

describe("loop: re-observation and FORM_CHANGED", () => {
  it("picks up a field that appears only after the action, without repeating the same write", async () => {
    const page: FakePage = { fields: [EMAIL_FIELD], values: {} };
    const ports = buildPorts(page, alwaysAllow);
    await recordAnswer(ports.memory, {
      profileId: DEFAULT_PROFILE_ID,
      key: "contact.email",
      value: "ananya@example.com",
      source: MemorySource.USER_PROVIDED,
      now: ports.clock(),
    });

    // Injected once the run has moved past its first OBSERVE — mirrors
    // dynamic.html's field appearing mid-run. `inspect_form` re-runs inside
    // VERIFY, so this must be picked up there, not cached from PLAN's view.
    let injected = false;
    const originalFields = page.fields;
    Object.defineProperty(page, "fields", {
      get: () =>
        injected
          ? [...originalFields, makeField({ id: "f2", label: "Referral" })]
          : originalFields,
    });

    // Step up to (but not through) VERIFY, so f1's write has already
    // happened but the re-observation VERIFY performs hasn't yet — that
    // re-observation is the one that must notice f2.
    let snapshot = createRun(ports, "https://example.com", 1);
    while (snapshot.run.state.phase !== AgentPhase.VERIFY) {
      snapshot = await step(snapshot, ports);
    }
    expect(page.values.f1).toBe("ananya@example.com");

    injected = true;
    snapshot = await drive(snapshot, ports);

    expect(snapshot.handled).toContain("f1");
    expect(page.values.f1).toBe("ananya@example.com");
    // f2 has no resolvable concept ("Referral" matches nothing), so it is
    // skipped rather than acted on again.
    expect(snapshot.fields.some((f) => f.id === "f2")).toBe(true);
  });
});

describe("loop: resumability — the run round-trips through JSON at every step", () => {
  it("keeps AgentRun JSON-serialisable after every transition", async () => {
    const page: FakePage = { fields: [EMAIL_FIELD], values: {} };
    const ports = buildPorts(page, alwaysAllow);
    await recordAnswer(ports.memory, {
      profileId: DEFAULT_PROFILE_ID,
      key: "contact.email",
      value: "ananya@example.com",
      source: MemorySource.USER_PROVIDED,
      now: ports.clock(),
    });

    let snapshot: RunSnapshot = createRun(ports, "https://example.com", 1);
    let iterations = 0;

    while (
      snapshot.run.state.status !== AgentStatus.COMPLETED &&
      iterations < 50
    ) {
      const before = snapshot.run;
      snapshot = await step(snapshot, ports);
      iterations++;

      if (snapshot.run === before) continue; // no-op step (e.g. DONE guard)
      expect(JSON.parse(JSON.stringify(snapshot.run))).toEqual(snapshot.run);
    }

    expect(snapshot.run.state.status).toBe(AgentStatus.COMPLETED);
  });
});
