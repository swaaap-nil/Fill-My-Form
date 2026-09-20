/**
 * Byte-size units for file-size limits.
 *
 * **These are binary (1024), deliberately.** A portal that says "maximum
 * 100 KB" is checking `size <= 102400` essentially every time, and the
 * pre-existing code in this repo — the `* 1024` the preparation tool used
 * for its KB field, and both copies of `formatBytes` — was binary too.
 * Switching to 1000 would silently change what every number a user has
 * already typed means, for no gain. The labels stay `KB`/`MB` rather than
 * `KiB`/`MiB` because that is what the forms say.
 */

export const BYTE_UNITS = ["B", "KB", "MB"] as const;

export type ByteUnit = (typeof BYTE_UNITS)[number];

const BYTES_PER_UNIT: Record<ByteUnit, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
};

export const isByteUnit = (value: string): value is ByteUnit =>
  (BYTE_UNITS as readonly string[]).includes(value);

export const toBytes = (value: number, unit: ByteUnit): number =>
  value * BYTES_PER_UNIT[unit];

export const fromBytes = (bytes: number, unit: ByteUnit): number =>
  bytes / BYTES_PER_UNIT[unit];

/**
 * The unit a size is most readable in — used to seed the unit selector from
 * an existing byte count so the field shows "2.5 MB" rather than "2560 KB".
 */
export const pickByteUnit = (bytes: number): ByteUnit => {
  if (bytes >= BYTES_PER_UNIT.MB) return "MB";
  if (bytes >= BYTES_PER_UNIT.KB) return "KB";
  return "B";
};

/**
 * The single formatter for byte counts. This replaces two identical copies
 * that had drifted apart into `file-preparation-tool.tsx` and
 * `prepared-file-handoff.tsx`.
 */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < BYTES_PER_UNIT.KB) return `${Math.round(bytes)} B`;
  if (bytes < BYTES_PER_UNIT.MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / BYTES_PER_UNIT.MB).toFixed(2)} MB`;
};

/** Formats a byte count in a specific unit, for prefilling an input. */
export const formatInUnit = (bytes: number, unit: ByteUnit): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const value = fromBytes(bytes, unit);
  return `${Number(value.toFixed(unit === "B" ? 0 : 2))}`;
};
