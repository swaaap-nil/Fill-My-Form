/**
 * Physical length units for image dimensions.
 *
 * Forms ask for sizes in whatever unit their paperwork uses — "35 × 45 mm"
 * on a passport portal, "2 × 2 in" on a US visa form, plain pixels on a
 * web-native upload. The conversion between them is not a display concern:
 * a millimetre is only a number of pixels *at some DPI*, so every function
 * here takes the DPI explicitly rather than assuming one.
 *
 * `DEFAULT_DPI` is 96 because that is the CSS reference pixel, which is what
 * a browser means by "an inch" when nothing else is specified. It is a
 * fallback for when a file carries no density header, not a preference —
 * prefer the source DPI parsed by `./dpi.ts`, and prefer the user's target
 * DPI over both.
 */

export const LENGTH_UNITS = ["px", "in", "cm", "mm"] as const;

export type LengthUnit = (typeof LENGTH_UNITS)[number];

export const DEFAULT_DPI = 96;

export const isLengthUnit = (value: string): value is LengthUnit =>
  (LENGTH_UNITS as readonly string[]).includes(value);

/** How many pixels one of `unit` is worth at `dpi`. */
const pixelsPerUnit = (unit: LengthUnit, dpi: number): number => {
  switch (unit) {
    case "px":
      return 1;
    case "in":
      return dpi;
    case "cm":
      return dpi / 2.54;
    case "mm":
      return dpi / 25.4;
  }
};

const usableDpi = (dpi: number): number =>
  Number.isFinite(dpi) && dpi > 0 ? dpi : DEFAULT_DPI;

/**
 * Exact, unrounded. Use this when the result feeds further arithmetic;
 * rounding in the middle of a conversion chain accumulates error.
 */
export const toPixels = (
  value: number,
  unit: LengthUnit,
  dpi: number,
): number => value * pixelsPerUnit(unit, usableDpi(dpi));

/**
 * Rounded to a whole pixel, floored at 1. Use this at the boundary where a
 * canvas or a spec needs an integer — a zero-width canvas throws, and a
 * fractional one is silently truncated by the platform anyway.
 */
export const toPixelsRounded = (
  value: number,
  unit: LengthUnit,
  dpi: number,
): number => Math.max(1, Math.round(toPixels(value, unit, dpi)));

export const fromPixels = (
  pixels: number,
  unit: LengthUnit,
  dpi: number,
): number => pixels / pixelsPerUnit(unit, usableDpi(dpi));

export const convertLength = (
  value: number,
  from: LengthUnit,
  to: LengthUnit,
  dpi: number,
): number => fromPixels(toPixels(value, from, dpi), to, dpi);

/**
 * How many decimal places are worth showing for a unit, so switching the
 * unit selector does not turn `45` into `45.000000000000006`. Pixels are
 * whole; physical units keep enough precision to round-trip a sane value.
 */
export const unitPrecision = (unit: LengthUnit): number =>
  unit === "px" ? 0 : unit === "mm" ? 1 : 2;

/** Formats a converted value for display in an input, without trailing zeros. */
export const formatLength = (value: number, unit: LengthUnit): string => {
  if (!Number.isFinite(value)) return "";
  const rounded = Number(value.toFixed(unitPrecision(unit)));
  return `${rounded}`;
};
