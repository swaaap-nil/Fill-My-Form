/**
 * What output dimensions a spec implies.
 *
 * This is arithmetic, so it lives here rather than in the adapter that calls
 * it — see `docs/testing.md`. It is also where two long-dormant `PreparationSpec`
 * fields finally become load-bearing.
 */

import { clampRatioToRange, ratioOf, withinRatioRange } from "./aspect-ratio";
import type { CropRect, PreparationSpec } from "./preparation";

export interface ResolvedTargetSize {
  readonly width: number;
  readonly height: number;
  readonly notes: readonly string[];
}

/**
 * `lockedAspectRatio` derives whichever side the user left blank. Without it,
 * setting only a width *stretched* the image: the other axis silently kept the
 * crop's pixel size, because nothing preserved the ratio at the draw step.
 *
 * `aspectRatio` — the tolerance range a form allows — is enforced by shrinking
 * the offending side. Shrinking rather than growing is deliberate: the pixels
 * to grow into do not exist, and upscaling to satisfy a ratio trades a rejected
 * upload for a blurry one.
 */
export const resolveTargetSize = (
  spec: PreparationSpec,
  crop: CropRect,
): ResolvedTargetSize => {
  const notes: string[] = [];
  const ratio = spec.lockedAspectRatio ?? ratioOf(crop.width, crop.height);

  let width = spec.targetWidth;
  let height = spec.targetHeight;

  if (ratio !== undefined && width !== undefined && height === undefined) {
    height = width / ratio;
    notes.push(
      `Height derived as ${Math.round(height)}px from the locked ratio`,
    );
  } else if (
    ratio !== undefined &&
    height !== undefined &&
    width === undefined
  ) {
    width = height * ratio;
    notes.push(`Width derived as ${Math.round(width)}px from the locked ratio`);
  }

  width = width ?? crop.width;
  height = height ?? crop.height;

  if (spec.aspectRatio) {
    const current = ratioOf(width, height);
    if (current !== undefined && !withinRatioRange(current, spec.aspectRatio)) {
      const target = clampRatioToRange(current, spec.aspectRatio);
      if (current > target) {
        width = height * target;
      } else {
        height = width / target;
      }
      notes.push(
        `Adjusted to ${Math.round(width)}x${Math.round(height)}px to satisfy the required aspect ratio`,
      );
    }
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    notes,
  };
};
