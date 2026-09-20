import { describe, expect, it } from "bun:test";
import { PENDING_DECISION_TTL_MS } from "~/core/fill/pending-decisions";
import type { FieldProposal } from "~/core/fill/types";
import { MemorySource } from "~/core/memory/types";
import {
  buildDetectionTabFillSnapshot,
  createTabFillSnapshotApi,
  isTabFillSnapshotExpired,
  isTabFillSnapshotStale,
  panelStateFromSnapshot,
  snapshotFromPanelState,
  type TabFillSessionStorage,
  type TabFillSnapshot,
} from "~/lib/tab-fill-snapshot";

const createMemorySession = (): TabFillSessionStorage & {
  readonly store: Map<string, unknown>;
} => {
  const store = new Map<string, unknown>();
  return {
    store,
    get: async (keys: string | string[] | null) => {
      if (keys === null) {
        return Object.fromEntries(store);
      }
      const keyList = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of keyList) {
        if (store.has(key)) out[key] = store.get(key);
      }
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
    },
    remove: async (keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) store.delete(key);
    },
  };
};

const sampleProposal = (): FieldProposal => ({
  fieldId: "f1",
  state: "pending",
  conceptKey: "person.name",
  decisionId: "d1",
  value: "Ada",
  payload: { kind: "text", value: "Ada" },
  source: MemorySource.USER_PROVIDED,
  policyReason: "ok",
});

describe("tab-fill-snapshot session api", () => {
  it("save and load roundtrip per tab", async () => {
    const session = createMemorySession();
    const api = createTabFillSnapshotApi(session);
    const snapshot = buildDetectionTabFillSnapshot({
      tabId: 3,
      pageUrl: "https://example.com/form",
      proposals: [sampleProposal()],
      uploadIntents: [],
      savedAtMs: 1_000,
    });

    await api.saveTabFillSnapshot(snapshot);
    await expect(api.loadTabFillSnapshot(3, { nowMs: 1_000 })).resolves.toEqual(
      snapshot,
    );
  });

  it("isolates snapshots by tab id", async () => {
    const session = createMemorySession();
    const api = createTabFillSnapshotApi(session);
    await api.saveTabFillSnapshot(
      buildDetectionTabFillSnapshot({
        tabId: 1,
        pageUrl: "https://a.test/",
        proposals: [],
        uploadIntents: [],
        savedAtMs: 1,
      }),
    );
    await api.saveTabFillSnapshot(
      buildDetectionTabFillSnapshot({
        tabId: 2,
        pageUrl: "https://b.test/",
        proposals: [],
        uploadIntents: [],
        savedAtMs: 1,
      }),
    );

    expect(await api.loadTabFillSnapshot(1, { nowMs: 1 })).toMatchObject({
      tabId: 1,
      pageUrl: "https://a.test/",
    });
    expect(await api.loadTabFillSnapshot(2, { nowMs: 1 })).toMatchObject({
      tabId: 2,
      pageUrl: "https://b.test/",
    });
  });

  it("returns undefined when expired", async () => {
    const session = createMemorySession();
    const api = createTabFillSnapshotApi(session);
    const savedAt = 0;
    await api.saveTabFillSnapshot(
      buildDetectionTabFillSnapshot({
        tabId: 5,
        pageUrl: "https://example.com/",
        proposals: [],
        uploadIntents: [],
        savedAtMs: savedAt,
      }),
    );

    expect(
      await api.loadTabFillSnapshot(5, {
        nowMs: savedAt + PENDING_DECISION_TTL_MS + 1,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when page url changed", async () => {
    const session = createMemorySession();
    const api = createTabFillSnapshotApi(session);
    await api.saveTabFillSnapshot(
      buildDetectionTabFillSnapshot({
        tabId: 8,
        pageUrl: "https://example.com/step-1",
        proposals: [],
        uploadIntents: [],
        savedAtMs: 100,
      }),
    );

    expect(
      await api.loadTabFillSnapshot(8, {
        nowMs: 100,
        currentUrl: "https://example.com/step-2",
      }),
    ).toBeUndefined();
  });

  it("clearTabFillSnapshot removes the entry", async () => {
    const session = createMemorySession();
    const api = createTabFillSnapshotApi(session);
    await api.saveTabFillSnapshot(
      buildDetectionTabFillSnapshot({
        tabId: 9,
        pageUrl: "https://example.com/",
        proposals: [],
        uploadIntents: [],
        savedAtMs: 1,
      }),
    );
    await api.clearTabFillSnapshot(9);
    expect(await api.loadTabFillSnapshot(9, { nowMs: 1 })).toBeUndefined();
  });
});

describe("panelStateFromSnapshot", () => {
  it("round-trips confirmed ids and dates", () => {
    const snapshot: TabFillSnapshot = snapshotFromPanelState({
      tabId: 1,
      scanState: {
        kind: "proposals",
        proposals: [sampleProposal()],
        uploadIntents: [],
      },
      scanUiState: "results",
      fillStatus: { kind: "ready" },
      lastScannedAt: new Date("2026-01-01T00:00:00.000Z"),
      confirmedIds: new Set(["d1"]),
      scanVersion: 2,
      pageUrl: "https://example.com/",
      savedAtMs: 100,
    });

    const panel = panelStateFromSnapshot(snapshot);
    expect(panel.scanVersion).toBe(2);
    expect([...panel.confirmedIds]).toEqual(["d1"]);
    expect(panel.lastScannedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("isTabFillSnapshotExpired", () => {
  it("treats ttl boundary as expired", () => {
    const snapshot = buildDetectionTabFillSnapshot({
      tabId: 1,
      pageUrl: "https://example.com/",
      proposals: [],
      uploadIntents: [],
      savedAtMs: 0,
    });
    expect(isTabFillSnapshotExpired(snapshot, PENDING_DECISION_TTL_MS)).toBe(
      false,
    );
    expect(
      isTabFillSnapshotExpired(snapshot, PENDING_DECISION_TTL_MS + 1),
    ).toBe(true);
  });
});

describe("buildDetectionTabFillSnapshot", () => {
  it("builds a proposals snapshot with results ui state", () => {
    const snapshot = buildDetectionTabFillSnapshot({
      tabId: 4,
      pageUrl: "https://jobs.test/apply",
      proposals: [sampleProposal()],
      uploadIntents: [],
      savedAtMs: 50,
    });
    expect(snapshot.scanState.kind).toBe("proposals");
    expect(snapshot.scanUiState).toBe("results");
    expect(
      isTabFillSnapshotStale(snapshot, "https://jobs.test/apply", 50),
    ).toBe(false);
  });
});
