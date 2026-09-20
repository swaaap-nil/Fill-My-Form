import { browser } from "wxt/browser";
import { PENDING_DECISION_TTL_MS } from "~/core/fill/pending-decisions";
import type { DecisionId, FieldProposal } from "~/core/fill/types";
import type { UploadIntent } from "~/core/form/types";

export interface TabFillSessionStorage {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export { PENDING_DECISION_TTL_MS as TAB_FILL_SNAPSHOT_TTL_MS };

export type TabFillSnapshotScanState =
  | { readonly kind: "idle" }
  | { readonly kind: "not_granted" }
  | {
      readonly kind: "proposals";
      readonly proposals: readonly FieldProposal[];
      readonly uploadIntents: readonly UploadIntent[];
    };

export type TabFillSnapshotFillStatus =
  | { readonly kind: "ready" }
  | { readonly kind: "filling"; readonly attemptedCount: number }
  | { readonly kind: "filled"; readonly filledCount: number }
  | {
      readonly kind: "partial";
      readonly attemptedCount: number;
      readonly filledCount: number;
    }
  | { readonly kind: "failed"; readonly attemptedCount: number };

export type TabFillSnapshotScanUiState =
  | "idle"
  | "scanning"
  | "results"
  | "filled"
  | "blocked"
  | "failed";

export interface TabFillSnapshot {
  readonly tabId: number;
  readonly savedAtMs: number;
  readonly scanState: TabFillSnapshotScanState;
  readonly scanUiState: TabFillSnapshotScanUiState;
  readonly fillStatus: TabFillSnapshotFillStatus;
  readonly lastScannedAtIso?: string;
  readonly confirmedIds: readonly DecisionId[];
  readonly scanVersion: number;
  readonly pageUrl?: string;
}

export interface TabFillPanelState {
  readonly scanState: TabFillSnapshotScanState;
  readonly scanUiState: TabFillSnapshotScanUiState;
  readonly fillStatus: TabFillSnapshotFillStatus;
  readonly lastScannedAt?: Date;
  readonly confirmedIds: ReadonlySet<DecisionId>;
  readonly scanVersion: number;
}

const keyFor = (tabId: number): string => `tab-fill-snapshot:${tabId}`;

export const isTabFillSnapshotExpired = (
  snapshot: TabFillSnapshot,
  nowMs: number = Date.now(),
): boolean => nowMs - snapshot.savedAtMs > PENDING_DECISION_TTL_MS;

export const isTabFillSnapshotStale = (
  snapshot: TabFillSnapshot,
  currentUrl?: string,
  nowMs: number = Date.now(),
): boolean => {
  if (isTabFillSnapshotExpired(snapshot, nowMs)) return true;
  if (currentUrl && snapshot.pageUrl && snapshot.pageUrl !== currentUrl) {
    return true;
  }
  return false;
};

export const panelStateFromSnapshot = (
  snapshot: TabFillSnapshot,
): TabFillPanelState => ({
  scanState: snapshot.scanState,
  scanUiState: snapshot.scanUiState,
  fillStatus: snapshot.fillStatus,
  lastScannedAt: snapshot.lastScannedAtIso
    ? new Date(snapshot.lastScannedAtIso)
    : undefined,
  confirmedIds: new Set(snapshot.confirmedIds),
  scanVersion: snapshot.scanVersion,
});

export interface SnapshotFromPanelInput {
  readonly tabId: number;
  readonly scanState: TabFillSnapshotScanState;
  readonly scanUiState: TabFillSnapshotScanUiState;
  readonly fillStatus: TabFillSnapshotFillStatus;
  readonly lastScannedAt?: Date;
  readonly confirmedIds: ReadonlySet<DecisionId>;
  readonly scanVersion: number;
  readonly pageUrl?: string;
  readonly savedAtMs?: number;
}

export const snapshotFromPanelState = (
  input: SnapshotFromPanelInput,
): TabFillSnapshot => ({
  tabId: input.tabId,
  savedAtMs: input.savedAtMs ?? Date.now(),
  scanState: input.scanState,
  scanUiState: input.scanUiState,
  fillStatus: input.fillStatus,
  lastScannedAtIso: input.lastScannedAt?.toISOString(),
  confirmedIds: [...input.confirmedIds],
  scanVersion: input.scanVersion,
  pageUrl: input.pageUrl,
});

export const buildDetectionTabFillSnapshot = (input: {
  readonly tabId: number;
  readonly pageUrl: string;
  readonly proposals: readonly FieldProposal[];
  readonly uploadIntents: readonly UploadIntent[];
  readonly savedAtMs?: number;
}): TabFillSnapshot =>
  snapshotFromPanelState({
    tabId: input.tabId,
    pageUrl: input.pageUrl,
    scanState: {
      kind: "proposals",
      proposals: input.proposals,
      uploadIntents: input.uploadIntents,
    },
    scanUiState: "results",
    fillStatus: { kind: "ready" },
    lastScannedAt: new Date(input.savedAtMs ?? Date.now()),
    confirmedIds: new Set(),
    scanVersion: 1,
    savedAtMs: input.savedAtMs,
  });

export const createTabFillSnapshotApi = (session: TabFillSessionStorage) => {
  const saveTabFillSnapshot = async (
    snapshot: TabFillSnapshot,
  ): Promise<void> => {
    await session.set({ [keyFor(snapshot.tabId)]: snapshot });
  };

  const loadTabFillSnapshot = async (
    tabId: number,
    options?: { readonly nowMs?: number; readonly currentUrl?: string },
  ): Promise<TabFillSnapshot | undefined> => {
    const stored = await session.get(keyFor(tabId));
    const snapshot = stored[keyFor(tabId)] as TabFillSnapshot | undefined;
    if (!snapshot || snapshot.tabId !== tabId) return undefined;
    if (
      isTabFillSnapshotStale(
        snapshot,
        options?.currentUrl,
        options?.nowMs ?? Date.now(),
      )
    ) {
      return undefined;
    }
    return snapshot;
  };

  const clearTabFillSnapshot = async (tabId: number): Promise<void> => {
    await session.remove(keyFor(tabId));
  };

  return { saveTabFillSnapshot, loadTabFillSnapshot, clearTabFillSnapshot };
};

let defaultApi: ReturnType<typeof createTabFillSnapshotApi> | undefined;

const getDefaultTabFillSnapshotApi = () => {
  defaultApi ??= createTabFillSnapshotApi(browser.storage.session);
  return defaultApi;
};

export const saveTabFillSnapshot = (snapshot: TabFillSnapshot): Promise<void> =>
  getDefaultTabFillSnapshotApi().saveTabFillSnapshot(snapshot);

export const loadTabFillSnapshot = (
  tabId: number,
  options?: { readonly nowMs?: number; readonly currentUrl?: string },
): Promise<TabFillSnapshot | undefined> =>
  getDefaultTabFillSnapshotApi().loadTabFillSnapshot(tabId, options);

export const clearTabFillSnapshot = (tabId: number): Promise<void> =>
  getDefaultTabFillSnapshotApi().clearTabFillSnapshot(tabId);
