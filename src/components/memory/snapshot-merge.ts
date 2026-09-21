/**
 * Merging a memory snapshot into local editing state.
 *
 * `getMemorySnapshot` is asynchronous, so the user can type before it
 * returns. Replacing local state wholesale then wipes what they just typed.
 * Each local edit is stamped with a monotonically increasing serial, and a
 * snapshot request remembers the serial it started at: any key edited after
 * that point keeps its local state, everything else takes the snapshot.
 */

type EditSerials = Readonly<Record<string, number>>;

const editedSince = (serials: EditSerials, serialAtStart: number) =>
  Object.entries(serials)
    .filter(([, serial]) => serial > serialAtStart)
    .map(([key]) => key);

/** Snapshot records, except keys edited locally after the request started. */
export const overlayLocalRecords = <T>(
  loaded: Readonly<Record<string, T>>,
  current: Readonly<Record<string, T>>,
  serials: EditSerials,
  serialAtStart: number,
): Record<string, T> => {
  const merged: Record<string, T> = { ...loaded };
  for (const key of editedSince(serials, serialAtStart)) {
    if (key in current) merged[key] = current[key] as T;
    else delete merged[key];
  }
  return merged;
};

/** Same rule for the set of keys known to be saved. */
export const overlaySavedKeys = (
  loaded: ReadonlySet<string>,
  current: ReadonlySet<string>,
  serials: EditSerials,
  serialAtStart: number,
): Set<string> => {
  const merged = new Set(loaded);
  for (const key of editedSince(serials, serialAtStart)) {
    if (current.has(key)) merged.add(key);
    else merged.delete(key);
  }
  return merged;
};
