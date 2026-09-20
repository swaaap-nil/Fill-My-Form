import type { DecisionId, PendingDecision } from "./types";

export const PENDING_DECISION_TTL_MS = 10 * 60 * 1000;

interface TabPendingDecision {
  readonly tabId: number;
  readonly expiresAt: number;
  readonly decision: PendingDecision;
}

/**
 * Short-lived, tab-scoped capabilities for the straight-line fill flow.
 *
 * The side panel confirms by id only; it never sends values back. This
 * registry is the capability check between that id and a page write: ids are
 * bound to the tab whose DOM was extracted, expire quickly, and are consumed
 * on every lookup attempt.
 */
export class PendingDecisionRegistry {
  readonly #decisions = new Map<DecisionId, TabPendingDecision>();
  readonly #ttlMs: number;

  constructor(ttlMs: number = PENDING_DECISION_TTL_MS) {
    this.#ttlMs = ttlMs;
  }

  remember(
    decisionId: DecisionId,
    tabId: number,
    decision: PendingDecision,
    now: number = Date.now(),
  ): void {
    this.pruneExpired(now);
    this.#decisions.set(decisionId, {
      tabId,
      decision,
      expiresAt: now + this.#ttlMs,
    });
  }

  take(
    decisionId: DecisionId,
    tabId: number,
    now: number = Date.now(),
  ): PendingDecision | null {
    this.pruneExpired(now);
    const pending = this.#decisions.get(decisionId);
    if (!pending) return null;

    this.#decisions.delete(decisionId);
    if (pending.tabId !== tabId || pending.expiresAt <= now) return null;
    return pending.decision;
  }

  clear(): void {
    this.#decisions.clear();
  }

  size(now: number = Date.now()): number {
    this.pruneExpired(now);
    return this.#decisions.size;
  }

  private pruneExpired(now: number): void {
    for (const [decisionId, pending] of this.#decisions) {
      if (pending.expiresAt <= now) this.#decisions.delete(decisionId);
    }
  }
}
