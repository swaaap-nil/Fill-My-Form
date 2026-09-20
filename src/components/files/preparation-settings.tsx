import type { ReactNode } from "react";
import { Input } from "~/components/ui/input";
import { SelectField } from "~/components/ui/select";
import { BYTE_UNITS, type ByteUnit } from "~/core/files/byte-units";
import { canWriteImageDensity } from "~/core/files/dpi";
import type { FileInspection } from "~/core/files/preparation";
import type { OutputFormat } from "~/core/files/preparation-form";
import { PREPARATION_PRESETS } from "~/core/files/presets";
import { LENGTH_UNITS, type LengthUnit } from "~/core/files/units";
import { cn } from "~/lib/utils";
import {
  PrepareStepBody,
  PrepareStepHeading,
  prepareStepPanelClass,
} from "./prepare-step-chrome";
import type { PreparationSettings as Settings } from "./use-preparation-settings";

const FORMAT_OPTIONS: readonly { value: OutputFormat; label: string }[] = [
  { value: "keep", label: "Same as original" },
  { value: "image/jpeg", label: "JPG (most forms)" },
  { value: "image/png", label: "PNG" },
  { value: "image/webp", label: "WebP" },
];

const unitOptions = (units: readonly string[]) =>
  units.map((unit) => ({ value: unit, label: unit }));

/** Final output settings for the side panel. Crop shape lives in the editor. */
export const PreparationSettings = ({
  inspection,
  settings,
  className,
  footer,
}: {
  readonly inspection: FileInspection;
  readonly settings: Settings;
  readonly className?: string;
  readonly footer?: ReactNode;
}) => {
  const { values, setValue, setDimension, setLengthUnit, setPreset } = settings;
  const isImage = inspection.kind === "image";
  const outputMimeType =
    values.format === "keep" ? inspection.mimeType : values.format;
  const dpiSupported = canWriteImageDensity(outputMimeType);
  const usingPhysicalUnits = values.lengthUnit !== "px";

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className={cn(prepareStepPanelClass, "gap-3")}>
        <PrepareStepHeading
          step={3}
          title="Match the form"
          description="Copy the size, file type, and limits from the upload page when it shows them."
        />

        <PrepareStepBody className="flex flex-col gap-3">
          <SelectField
            id="prepare-preset"
            label="Common requirements"
            value={values.presetId}
            onValueChange={setPreset}
            options={PREPARATION_PRESETS.map((preset) => ({
              value: preset.id,
              label: preset.label,
            }))}
          />

          {isImage && (
            <>
              <div className={cn("grid gap-2", "grid-cols-[1fr_1fr_auto]")}>
                <label
                  htmlFor="prepare-width"
                  className="flex min-w-0 flex-col gap-1 text-xs"
                >
                  <span className="text-muted-foreground">Width</span>
                  <Input
                    id="prepare-width"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="Auto"
                    value={values.widthValue}
                    onChange={(event) =>
                      setDimension("width", event.target.value)
                    }
                  />
                </label>
                <label
                  htmlFor="prepare-height"
                  className="flex min-w-0 flex-col gap-1 text-xs"
                >
                  <span className="text-muted-foreground">Height</span>
                  <Input
                    id="prepare-height"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="Auto"
                    value={values.heightValue}
                    onChange={(event) =>
                      setDimension("height", event.target.value)
                    }
                  />
                </label>
                <SelectField
                  id="prepare-length-unit"
                  label="Unit"
                  value={values.lengthUnit}
                  onValueChange={(next) => setLengthUnit(next as LengthUnit)}
                  options={unitOptions(LENGTH_UNITS)}
                  className="w-20"
                />
              </div>

              {usingPhysicalUnits &&
                settings.displayDpi !== undefined &&
                (settings.pixelSize.width || settings.pixelSize.height) && (
                  <p className="text-muted-foreground text-xs">
                    {values.widthValue || "auto"} ×{" "}
                    {values.heightValue || "auto"} {values.lengthUnit} at{" "}
                    {Math.round(settings.displayDpi)} DPI ={" "}
                    {settings.pixelSize.width ?? "auto"} ×{" "}
                    {settings.pixelSize.height ?? "auto"} px
                  </p>
                )}

              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  id="prepare-format"
                  label="Save as"
                  value={values.format}
                  onValueChange={(next) =>
                    setValue("format", next as OutputFormat)
                  }
                  options={FORMAT_OPTIONS}
                />
                <label
                  htmlFor="prepare-dpi"
                  className="flex min-w-0 flex-col gap-1 text-xs"
                >
                  <span className="text-muted-foreground">
                    DPI (if required)
                  </span>
                  <Input
                    id="prepare-dpi"
                    type="number"
                    min="1"
                    inputMode="numeric"
                    placeholder={dpiSupported ? "Optional" : "Unsupported"}
                    value={dpiSupported ? values.dpiValue : ""}
                    disabled={!dpiSupported}
                    onChange={(event) =>
                      setValue("dpiValue", event.target.value)
                    }
                  />
                </label>
              </div>

              {!dpiSupported && (
                <p className="text-muted-foreground text-xs">
                  WebP cannot store a DPI value. Choose JPG or PNG if the form
                  asks for one.
                </p>
              )}
            </>
          )}

          <div className="flex min-w-0 items-end gap-1.5">
            <label
              htmlFor="prepare-max-size"
              className="flex min-w-0 flex-1 flex-col gap-1 text-xs"
            >
              <span className="text-muted-foreground">
                Max file size (if required)
              </span>
              <Input
                id="prepare-max-size"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="Optional"
                value={values.maxSizeValue}
                onChange={(event) =>
                  setValue("maxSizeValue", event.target.value)
                }
              />
            </label>
            <SelectField
              id="prepare-max-size-unit"
              label=""
              value={values.maxSizeUnit}
              onValueChange={(next) =>
                setValue("maxSizeUnit", next as ByteUnit)
              }
              options={unitOptions(BYTE_UNITS)}
              className="w-18 shrink-0"
            />
          </div>

          {inspection.kind === "pdf" && (
            <div className="flex flex-col gap-2 border-border border-t pt-3">
              <p className="font-medium text-foreground text-xs">PDF pages</p>
              <div className="grid grid-cols-2 gap-2">
                <label
                  htmlFor="prepare-page-start"
                  className="flex flex-col gap-1 text-xs"
                >
                  <span className="text-muted-foreground">First page</span>
                  <Input
                    id="prepare-page-start"
                    type="number"
                    min="1"
                    value={values.pageStart}
                    onChange={(event) =>
                      setValue("pageStart", event.target.value)
                    }
                  />
                </label>
                <label
                  htmlFor="prepare-page-end"
                  className="flex flex-col gap-1 text-xs"
                >
                  <span className="text-muted-foreground">Last page</span>
                  <Input
                    id="prepare-page-end"
                    type="number"
                    min="1"
                    placeholder={`${inspection.pageCount ?? 1}`}
                    value={values.pageEnd}
                    onChange={(event) =>
                      setValue("pageEnd", event.target.value)
                    }
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label
                  htmlFor="prepare-page-width"
                  className="flex flex-col gap-1 text-xs"
                >
                  <span className="text-muted-foreground">Page width (pt)</span>
                  <Input
                    id="prepare-page-width"
                    type="number"
                    min="1"
                    placeholder="Keep original"
                    value={values.pageWidth}
                    onChange={(event) =>
                      setValue("pageWidth", event.target.value)
                    }
                  />
                </label>
                <label
                  htmlFor="prepare-page-height"
                  className="flex flex-col gap-1 text-xs"
                >
                  <span className="text-muted-foreground">
                    Page height (pt)
                  </span>
                  <Input
                    id="prepare-page-height"
                    type="number"
                    min="1"
                    placeholder="Keep original"
                    value={values.pageHeight}
                    onChange={(event) =>
                      setValue("pageHeight", event.target.value)
                    }
                  />
                </label>
              </div>
            </div>
          )}

          {settings.issues.length > 0 && (
            <ul className="flex flex-col gap-1 border-border border-t pt-2">
              {settings.issues.map((issue) => (
                <li key={issue} className="text-muted-foreground text-xs">
                  {issue}
                </li>
              ))}
            </ul>
          )}

          {footer ? (
            <div className="flex flex-col gap-2 border-border border-t pt-3">
              {footer}
            </div>
          ) : null}
        </PrepareStepBody>
      </div>
    </div>
  );
};
