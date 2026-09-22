import { describe, expect, it } from "bun:test";
import {
  type ConfirmFillDeps,
  type ConfirmFillMessaging,
  confirmFillHandler,
  type FillFileAdapter,
  getMemorySnapshotHandler,
  pendingInputFor,
  toRunView,
} from "~/app/background/handlers";
import type { RunSnapshot } from "~/core/agent/loop";
import { PendingDecisionRegistry } from "~/core/fill/pending-decisions";
import type { PendingDecision } from "~/core/fill/types";
import { FieldKind } from "~/core/form/types";
import { createInMemoryMemoryStore } from "~/core/memory/in-memory";
import { DEFAULT_PROFILE_ID, MemorySource } from "~/core/memory/types";
import { recordAnswer } from "~/core/memory/write-service";
import { Sensitivity } from "~/core/ontology/types";
import { ActionRisk, ConfidenceLevel } from "~/core/policy/types";

/**
 * Coverage for the seam `handlers.ts` exists to create: `confirmFill` and
 * `getMemorySnapshot`'s real logic, run against fakes instead of a browser —
 * `e2e/fill.spec.ts`, `e2e/files.spec.ts` and `e2e/verify.spec.ts` stay the
 * end-to-end proof that `index.ts` wires the real singletons into these
 * functions correctly. `toRunView`/`pendingInputFor` are pure and need no
 * fake at all.
 */

const textDecision = (
  overrides: Partial<PendingDecision> = {},
): PendingDecision => ({
  fieldId: "0/aaaaaaaa/0",
  payload: { kind: "text", value: "ananya@example.com" },
  conceptKey: "contact.email",
  sensitivity: Sensitivity.PERSONAL,
  risk: ActionRisk.MEDIUM,
  confidence: ConfidenceLevel.HIGH,
  ...overrides,
});

const fakeMessaging = (): ConfirmFillMessaging & {
  fillFieldCalls: unknown[];
  uploadFileCalls: unknown[];
  showFillFeedbackCalls: unknown[];
} => {
  const fillFieldCalls: unknown[] = [];
  const uploadFileCalls: unknown[] = [];
  const showFillFeedbackCalls: unknown[] = [];
  return {
    fillFieldCalls,
    uploadFileCalls,
    showFillFeedbackCalls,
    fillField: async (data) => {
      fillFieldCalls.push(data);
      return { ok: true };
    },
    uploadFile: async (data) => {
      uploadFileCalls.push(data);
      return { ok: true };
    },
    showFillFeedback: async (data) => {
      showFillFeedbackCalls.push(data);
      return { ok: true };
    },
  };
};

const noFileAdapter: FillFileAdapter = {
  prepareLocalFile: async () => null,
  cleanupPreparedFile: async () => {},
};

const buildDeps = (
  overrides: Partial<ConfirmFillDeps> = {},
): ConfirmFillDeps => ({
  memoryStore: createInMemoryMemoryStore(),
  files: noFileAdapter,
  pendingDecisions: new PendingDecisionRegistry(),
  hasSiteAccess: async () => true,
  messaging: fakeMessaging(),
  now: () => "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("confirmFillHandler", () => {
  it("refuses every decision when the tab has no site access, without touching pendingDecisions", async () => {
    const pendingDecisions = new PendingDecisionRegistry();
    pendingDecisions.remember("d1", 7, textDecision());
    const deps = buildDeps({
      pendingDecisions,
      hasSiteAccess: async () => false,
    });

    const result = await confirmFillHandler(deps, {
      decisionIds: ["d1"],
      tabId: 7,
    });

    expect(result.results).toEqual([{ decisionId: "d1", ok: false }]);
    // Not consumed: a real retry (after access is re-granted) could still use it.
    expect(pendingDecisions.take("d1", 7)).not.toBeNull();
  });

  it("refuses a decisionId that was never remembered, or already consumed", async () => {
    const deps = buildDeps();
    const result = await confirmFillHandler(deps, {
      decisionIds: ["missing"],
      tabId: 7,
    });
    expect(result.results).toEqual([{ decisionId: "missing", ok: false }]);
  });

  it("writes a text field, records the answer to memory, and reports success", async () => {
    const pendingDecisions = new PendingDecisionRegistry();
    pendingDecisions.remember("d1", 7, textDecision());
    const memoryStore = createInMemoryMemoryStore();
    const messaging = fakeMessaging();
    const deps = buildDeps({ pendingDecisions, memoryStore, messaging });

    const result = await confirmFillHandler(deps, {
      decisionIds: ["d1"],
      tabId: 7,
    });

    expect(result.results).toEqual([{ decisionId: "d1", ok: true }]);
    expect(messaging.fillFieldCalls).toEqual([
      {
        decisionId: "d1",
        fieldId: "0/aaaaaaaa/0",
        value: "ananya@example.com",
      },
    ]);

    const stored = await memoryStore.get(DEFAULT_PROFILE_ID, "contact.email");
    expect(stored?.value).toBe("ananya@example.com");
    expect(messaging.showFillFeedbackCalls).toEqual([{ filledCount: 1 }]);
  });

  it("stores memoryValue instead of the page's opaque option value, when present", async () => {
    const pendingDecisions = new PendingDecisionRegistry();
    pendingDecisions.remember(
      "d1",
      7,
      textDecision({
        payload: { kind: "text", value: "IN" },
        memoryValue: "India",
        conceptKey: "contact.address.country",
      }),
    );
    const memoryStore = createInMemoryMemoryStore();
    const deps = buildDeps({ pendingDecisions, memoryStore });

    await confirmFillHandler(deps, { decisionIds: ["d1"], tabId: 7 });

    const stored = await memoryStore.get(
      DEFAULT_PROFILE_ID,
      "contact.address.country",
    );
    expect(stored?.value).toBe("India");
  });

  it("does not record to memory when the write itself fails", async () => {
    const pendingDecisions = new PendingDecisionRegistry();
    pendingDecisions.remember("d1", 7, textDecision());
    const memoryStore = createInMemoryMemoryStore();
    const messaging: ConfirmFillMessaging = {
      ...fakeMessaging(),
      fillField: async () => ({ ok: false }),
    };
    const deps = buildDeps({ pendingDecisions, memoryStore, messaging });

    const result = await confirmFillHandler(deps, {
      decisionIds: ["d1"],
      tabId: 7,
    });

    expect(result.results).toEqual([{ decisionId: "d1", ok: false }]);
    expect(
      await memoryStore.get(DEFAULT_PROFILE_ID, "contact.email"),
    ).toBeNull();
  });

  it("does not fire showFillFeedback when nothing was actually filled", async () => {
    const messaging = fakeMessaging();
    const deps = buildDeps({ messaging });

    await confirmFillHandler(deps, { decisionIds: ["missing"], tabId: 7 });

    expect(messaging.showFillFeedbackCalls).toEqual([]);
  });

  it("re-checks site access before each write, not only once up front", async () => {
    // Simulates access being revoked between the two decisions in one batch.
    let calls = 0;
    const pendingDecisions = new PendingDecisionRegistry();
    pendingDecisions.remember("d1", 7, textDecision());
    pendingDecisions.remember("d2", 7, textDecision({ fieldId: "0/bb/0" }));
    const deps = buildDeps({
      pendingDecisions,
      hasSiteAccess: async () => {
        calls += 1;
        return calls <= 2; // allows the up-front check + d1's, denies d2's.
      },
    });

    const result = await confirmFillHandler(deps, {
      decisionIds: ["d1", "d2"],
      tabId: 7,
    });

    const byId = Object.fromEntries(
      result.results.map((r) => [r.decisionId, r.ok]),
    );
    expect(byId.d1).toBe(true);
    expect(byId.d2).toBe(false);
  });
});

describe("getMemorySnapshotHandler", () => {
  it("returns every stored item for the default profile", async () => {
    const memoryStore = createInMemoryMemoryStore();
    await recordAnswer(memoryStore, {
      profileId: DEFAULT_PROFILE_ID,
      key: "contact.email",
      value: "ananya@example.com",
      source: MemorySource.USER_PROVIDED,
      now: "2026-01-01T00:00:00.000Z",
    });

    const result = await getMemorySnapshotHandler({ memoryStore });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.key).toBe("contact.email");
  });

  it("returns an empty list, not an error, for a store with nothing saved", async () => {
    const result = await getMemorySnapshotHandler({
      memoryStore: createInMemoryMemoryStore(),
    });
    expect(result.items).toEqual([]);
  });
});

describe("toRunView / pendingInputFor", () => {
  const baseSnapshot = (
    overrides: Partial<RunSnapshot["run"]["state"]> = {},
  ): RunSnapshot =>
    ({
      run: {
        id: "run_1",
        state: {
          phase: "act",
          status: "waiting_for_user",
          pendingQuestion: undefined,
          ...overrides,
        },
      },
      tabId: 1,
      origin: "https://example.test",
      fields: [],
      cursor: undefined,
      cursorAttempts: 0,
      pendingDecision: undefined,
    }) as unknown as RunSnapshot;

  it("reports pendingInput: text when waiting on a non-file field", () => {
    const snapshot = {
      ...baseSnapshot(),
      cursor: "0/aa/0",
      pendingDecision: { action: { type: "ask_user" } },
      fields: [{ id: "0/aa/0", kind: FieldKind.TEXT, constraints: [] }],
    } as unknown as RunSnapshot;

    expect(pendingInputFor(snapshot)).toEqual({ kind: "text" });
  });

  it("reports pendingInput: file, with the accept constraint, for a file field", () => {
    const snapshot = {
      ...baseSnapshot(),
      cursor: "0/bb/0",
      pendingDecision: { action: { type: "ask_user" } },
      fields: [
        {
          id: "0/bb/0",
          kind: FieldKind.FILE,
          label: "Resume",
          constraints: [{ kind: "accept", value: [".pdf"] }],
        },
      ],
    } as unknown as RunSnapshot;

    expect(pendingInputFor(snapshot)).toEqual({
      kind: "file",
      fieldId: "0/bb/0",
      label: "Resume",
      accept: [".pdf"],
      constraints: [{ kind: "accept", value: [".pdf"] }],
    });
  });

  it("reports no pendingInput when the run isn't actually waiting on ask_user", () => {
    const snapshot = {
      ...baseSnapshot({ status: "running" }),
      cursor: "0/aa/0",
      pendingDecision: { action: { type: "ask_user" } },
      fields: [{ id: "0/aa/0", kind: FieldKind.TEXT, constraints: [] }],
    } as unknown as RunSnapshot;

    expect(pendingInputFor(snapshot)).toBeUndefined();
  });

  it("toRunView carries the run id, phase and status straight through", () => {
    const snapshot = baseSnapshot({ status: "running", phase: "plan" });
    const view = toRunView(snapshot);
    expect(view.runId).toBe("run_1");
    expect(view.phase).toBe("plan");
    expect(view.status).toBe("running");
    expect(view.pendingInput).toBeUndefined();
  });
});
