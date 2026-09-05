import type {
  MemoryItem,
  MemoryKey,
  MemoryQuery,
  MemoryValue,
  ProfileId,
} from "./types";

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
 *
 * Every per-key method takes a `profileId` — see `ProfileId` in `./types`
 * for why that dimension exists from the first implementation rather than
 * being retrofitted later.
 */
export interface MemoryStore {
  get(profileId: ProfileId, key: MemoryKey): Promise<MemoryItem | null>;
  set(item: MemoryItem): Promise<void>;
  update(
    profileId: ProfileId,
    key: MemoryKey,
    value: MemoryValue,
  ): Promise<void>;
  delete(profileId: ProfileId, key: MemoryKey): Promise<void>;
  search(query: MemoryQuery): Promise<MemoryItem[]>;
}
