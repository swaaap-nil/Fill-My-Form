/**
 * Starting points for common upload requirements.
 *
 * **Presets describe document kinds, never particular sites.** "Passport or
 * ID photo" is a class of requirement that recurs across thousands of forms;
 * a preset named after one portal would be exactly the page-specific special
 * casing `AGENTS.md` forbids. If a site needs something these do not cover,
 * the answer is the Custom preset and better constraint detection, not a new
 * entry here.
 *
 * Dimensions carry their own unit, because the requirement is usually stated
 * in one: passport photos are specified in millimetres at a print DPI, while
 * a web avatar is specified in pixels. Storing "35 mm at 300 DPI" rather than
 * the pre-multiplied 413 px keeps the preset honest when the user changes the
 * target DPI.
 */

import { toBytes } from "./byte-units";
import type { LengthUnit } from "./units";

export interface PreparationPreset {
  readonly id: string;
  readonly label: string;
  readonly width?: number;
  readonly height?: number;
  readonly unit: LengthUnit;
  /** Target print resolution, where the requirement implies one. */
  readonly dpi?: number;
  /** Width / height. Derived from the dimensions when both are present. */
  readonly ratio?: number;
  readonly maxBytes?: number;
  readonly outputMimeType?: string;
}

export const CUSTOM_PRESET_ID = "custom";

export const PREPARATION_PRESETS: readonly PreparationPreset[] = [
  { id: CUSTOM_PRESET_ID, label: "Custom", unit: "px" },
  {
    id: "passport",
    label: "Passport / ID photo",
    width: 35,
    height: 45,
    unit: "mm",
    dpi: 300,
    ratio: 35 / 45,
    maxBytes: toBytes(200, "KB"),
    outputMimeType: "image/jpeg",
  },
  {
    id: "photograph",
    label: "Photograph",
    width: 530,
    height: 690,
    unit: "px",
    ratio: 530 / 690,
    maxBytes: toBytes(100, "KB"),
    outputMimeType: "image/jpeg",
  },
  {
    id: "signature",
    label: "Signature",
    width: 580,
    height: 180,
    unit: "px",
    ratio: 580 / 180,
    maxBytes: toBytes(50, "KB"),
    outputMimeType: "image/jpeg",
  },
  {
    id: "square",
    label: "Square avatar",
    width: 600,
    height: 600,
    unit: "px",
    ratio: 1,
    outputMimeType: "image/png",
  },
];

export const presetById = (id: string): PreparationPreset | undefined =>
  PREPARATION_PRESETS.find((preset) => preset.id === id);
