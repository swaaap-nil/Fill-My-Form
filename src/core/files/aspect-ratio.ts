/**
 * Aspect ratios, parsed from what a human would type.
 *
 * The old UI asked for a bare decimal — `0.768` for a 530 × 690 photograph —
 * which is a number nobody has on hand. Forms state ratios as `4:5` or
 * `3.5 x 4.5`, so that is what `parseAspectRatio` accepts, with the decimal
 * form still working for anyone who has one.
 *
 * Throughout this module a ratio is **width / height**, so values above 1 are
 * landscape. That matches `CropperSelection.aspectRatio`, which is what these
 * numbers are ultimately handed to.
 */

const SEPARATOR = /[:/x×]/i;

/**
 * Accepts `"4:5"`, `"4/5"`, `"4 x 5"`, `"3.5 × 4.5"` and `"0.8"`.
 * Returns `undefined` for anything that is not a usable positive ratio —
 * empty input, zero or negative components, division by zero, or junk.
 */
export const parseAspectRatio = (input: string): number | undefined => {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const parts = trimmed.split(SEPARATOR);
  if (parts.length > 2) return undefined;

  if (parts.length === 2) {
    const width = Number(parts[0]?.trim());
    const height = Number(parts[1]?.trim());
    if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
    if (width <= 0 || height <= 0) return undefined;
    return width / height;
  }

  const ratio = Number(trimmed);
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined;
  return ratio;
};

/**
 * The inverse, biased towards the readable form: a ratio that is very close
 * to a small whole-number pair comes back as `"4:5"`, anything else as a
 * rounded decimal. Used to show a ratio derived from a crop or a preset.
 */
export const formatAspectRatio = (ratio: number): string => {
  if (!Number.isFinite(ratio) || ratio <= 0) return "";
  for (let height = 1; height <= 16; height += 1) {
    const width = ratio * height;
    if (Math.abs(width - Math.round(width)) < 0.001 && Math.round(width) > 0) {
      return `${Math.round(width)}:${height}`;
    }
  }
  return `${Number(ratio.toFixed(4))}`;
};

export const ratioOf = (width: number, height: number): number | undefined =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : undefined;

/**
 * Given which side the user just edited, derive the other so the pair holds
 * `ratio`. Returns both sides so the caller can apply them in one update —
 * the lock is a property of the state transition, not a side effect to run
 * afterwards.
 *
 * When the edited side is missing or unusable, the other side is left alone
 * rather than being cleared: a half-typed "3" on the way to "35" should not
 * wipe the field next to it.
 */
export const applyAspectLock = (
  edited: "width" | "height",
  width: number | undefined,
  height: number | undefined,
  ratio: number,
): { width?: number; height?: number } => {
  if (!Number.isFinite(ratio) || ratio <= 0) return { width, height };

  if (edited === "width") {
    if (width === undefined || !Number.isFinite(width) || width <= 0) {
      return { width, height };
    }
    return { width, height: width / ratio };
  }

  if (height === undefined || !Number.isFinite(height) || height <= 0) {
    return { width, height };
  }
  return { width: height * ratio, height };
};

/**
 * Whether a ratio satisfies a constraint *range* — the tolerance a form
 * allows, as opposed to `lockedAspectRatio`, which is one exact value the
 * user pinned. Conflating those two is why `PreparationSpec.aspectRatio`
 * sat unread for so long.
 */
export const withinRatioRange = (
  ratio: number,
  range: { readonly min: number; readonly max: number },
): boolean => ratio >= range.min && ratio <= range.max;

/** The nearest ratio inside `range`, for nudging an out-of-range result in. */
export const clampRatioToRange = (
  ratio: number,
  range: { readonly min: number; readonly max: number },
): number => Math.min(Math.max(ratio, range.min), range.max);
