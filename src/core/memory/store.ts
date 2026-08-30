import type { MemoryItem, MemoryKey, MemoryQuery, MemoryValue } from "./types";

/**
 * The single interface every memory backend implements.
 *
 * Planned implementations, in order:
 *   1. in-memory  — tests
 *   2. IndexedDB  — production, local-only
 *
 * A remote-backed implementation is deliberately not planned. If one is ever
 * needed it becomes an explicit, separately-consented feature with its own
 * ADR, not a swapped-in adapter.
 */
export interface MemoryStore {
  get(key: MemoryKey): Promise<MemoryItem | null>;
  set(item: MemoryItem): Promise<void>;
  update(key: MemoryKey, value: MemoryValue): Promise<void>;
  delete(key: MemoryKey): Promise<void>;
  search(query: MemoryQuery): Promise<MemoryItem[]>;
}
