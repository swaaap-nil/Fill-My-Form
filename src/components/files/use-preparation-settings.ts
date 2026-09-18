import { useCallback, useMemo, useState } from "react";
import type { CropRect, FileInspection } from "~/core/files/preparation";
import {
  applyPreset as applyPresetValues,
  effectiveDpi,
  emptyPreparationFormValues,
  type PreparationFormValues,
  preparationFormValuesFrom,
  resolvePixelSize,
  resolvePreparationSpec,
  setDimension as setDimensionValue,
  setLengthUnit as setLengthUnitValue,
} from "~/core/files/preparation-form";
import { presetById } from "~/core/files/presets";
import type { LengthUnit } from "~/core/files/units";

/**
 * The preparation form's state, in one place, shared by the side panel and the
 * editor window so output settings and crop edits can be handed between them.
 *
 * Every transition that is more than "store what was typed" — crop ratio,
 * unit conversion, applying a preset — is delegated to the pure functions in
 * `~/core/files/preparation-form`. The component holds no rules of its own.
 */
export const usePreparationSettings = (inspection?: FileInspection) => {
  const [values, setValues] = useState<PreparationFormValues>(
    emptyPreparationFormValues,
  );

  const setValue = useCallback(
    <Key extends keyof PreparationFormValues>(
      key: Key,
      next: PreparationFormValues[Key],
    ) => {
      setValues((current) => ({ ...current, [key]: next }));
    },
    [],
  );

  const setDimension = useCallback(
    (edited: "width" | "height", next: string) => {
      setValues((current) => setDimensionValue(current, edited, next));
    },
    [],
  );

  const setLengthUnit = useCallback(
    (unit: LengthUnit) => {
      setValues((current) => setLengthUnitValue(current, unit, inspection));
    },
    [inspection],
  );

  const setPreset = useCallback((presetId: string) => {
    const preset = presetById(presetId);
    if (!preset) return;
    setValues((current) => applyPresetValues(current, preset));
  }, []);

  const setCrop = useCallback((crop: CropRect | undefined) => {
    setValues((current) => ({ ...current, crop }));
  }, []);

  /** Re-seeds from a newly chosen file, keeping nothing from the last one. */
  const resetFor = useCallback((next: FileInspection | undefined) => {
    setValues(
      next ? preparationFormValuesFrom(next) : emptyPreparationFormValues,
    );
  }, []);

  const resolved = useMemo(
    () => (inspection ? resolvePreparationSpec(values, inspection) : undefined),
    [values, inspection],
  );

  return {
    values,
    setValue,
    setValues,
    setDimension,
    setLengthUnit,
    setPreset,
    setCrop,
    resetFor,
    spec: resolved?.spec,
    issues: resolved?.issues ?? [],
    pixelSize: resolvePixelSize(values, inspection),
    dpi: effectiveDpi(values, inspection),
  };
};

export type PreparationSettings = ReturnType<typeof usePreparationSettings>;
