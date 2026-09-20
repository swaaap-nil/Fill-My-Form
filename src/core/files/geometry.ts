/**
 * Rectangle arithmetic for the crop selection.
 *
 * This exists as pure functions, away from the DOM, for one reason: the
 * cropper's out-of-bounds bug — a selection that extends past the image, so
 * the export contains blank strips nobody asked for — is a *geometry* bug,
 * and geometry is testable without a browser. Cropper.js v2 has no bounding
 * option of its own (there is no `bounded` attribute on `cropper-selection`;
 * see the class surface in `cropperjs/dist/cropper.d.ts`), so the clamp has
 * to be ours. Keeping the rule here means it is covered by `bun test` rather
 * than only by an end-to-end drag.
 *
 * All rects are `{ x, y, width, height }` in one consistent space; the caller
 * is responsible for converting between screen and natural-image coordinates
 * before calling in.
 */

import type { CropRect } from "./preparation";

/**
 * Sub-pixel slack. Browser `getBoundingClientRect` values are fractional, so
 * a selection that is visually flush with the image edge routinely reports as
 * a thousandth of a pixel outside it. Without tolerance the clamp would fight
 * the user at every edge.
 */
const EPSILON = 0.01;

export const rectContains = (
  outer: CropRect,
  inner: CropRect,
  epsilon: number = EPSILON,
): boolean =>
  inner.x >= outer.x - epsilon &&
  inner.y >= outer.y - epsilon &&
  inner.x + inner.width <= outer.x + outer.width + epsilon &&
  inner.y + inner.height <= outer.y + outer.height + epsilon;

/**
 * Bring `inner` inside `outer`, preferring to **move** it and only shrinking
 * when it genuinely does not fit. Shrinking a selection the user is dragging
 * feels like the app fighting back; sliding it does not.
 */
export const clampRectTo = (outer: CropRect, inner: CropRect): CropRect => {
  const width = Math.min(inner.width, outer.width);
  const height = Math.min(inner.height, outer.height);
  const x = Math.min(Math.max(inner.x, outer.x), outer.x + outer.width - width);
  const y = Math.min(
    Math.max(inner.y, outer.y),
    outer.y + outer.height - height,
  );
  return { x, y, width, height };
};

export const boundCropSelection = (
  bounds: CropRect,
  selection: CropRect,
  ratio?: number,
): CropRect =>
  typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0
    ? fitWithinRatio(selection, ratio, bounds)
    : clampRectTo(bounds, selection);

/** Scales a rect about its own centre, which is what a zoom step should do. */
export const scaleRect = (rect: CropRect, factor: number): CropRect => {
  const width = rect.width * factor;
  const height = rect.height * factor;
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
};

/**
 * The largest rect of the given ratio that fits inside `outer`, centred on
 * `rect`'s centre and then clamped. Used when the aspect lock is switched on
 * with a selection already in place, and after a rotation changes what "fits".
 */
export const fitWithinRatio = (
  rect: CropRect,
  ratio: number,
  outer: CropRect,
): CropRect => {
  if (!Number.isFinite(ratio) || ratio <= 0) return clampRectTo(outer, rect);

  const maxWidth = Math.min(outer.width, outer.height * ratio);
  const maxHeight = maxWidth / ratio;
  const width = Math.min(Math.max(rect.width, 1), maxWidth);
  const height = width / ratio;

  const centred: CropRect = {
    x: rect.x + rect.width / 2 - width / 2,
    y: rect.y + rect.height / 2 - height / 2,
    width,
    height: Math.min(height, maxHeight),
  };
  return clampRectTo(outer, centred);
};

export const rectArea = (rect: CropRect): number => rect.width * rect.height;

export const rectsEqual = (
  a: CropRect,
  b: CropRect,
  epsilon: number = EPSILON,
): boolean =>
  Math.abs(a.x - b.x) < epsilon &&
  Math.abs(a.y - b.y) < epsilon &&
  Math.abs(a.width - b.width) < epsilon &&
  Math.abs(a.height - b.height) < epsilon;
