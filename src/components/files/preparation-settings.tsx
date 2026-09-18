import { Link2, Unlink2 } from "lucide-react";
import { CheckboxField } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { SelectField } from "~/components/ui/select";
import { BYTE_UNITS, type ByteUnit } from "~/core/files/byte-units";
import { canWriteImageDensity } from "~/core/files/dpi";
import type { FileInspection } from "~/core/files/preparation";
import type { OutputFormat } from "~/core/files/preparation-form";
import { PREPARATION_PRESETS } from "~/core/files/presets";
import { LENGTH_UNITS, type LengthUnit } from "~/core/files/units";
import { cn } from "~/lib/utils";
import type { PreparationSettings as Settings } from "./use-preparation-settings";

const FORMAT_OPTIONS: readonly { value: OutputFormat; label: string }[] = [
  { value: "keep", label: "Keep original" },
  { value: "image/jpeg", label: "JPEG (.jpg)" },
  { value: "image/png", label: "PNG (.png)" },
  { value: "image/webp", label: "WebP (.webp)" },
];

const unitOptions = (units: readonly string[]) =>
  units.map((unit) => ({ value: unit, label: unit }));

/**
 * One settings form, two hosts. `layout` changes only density and grid
 * columns: the side panel gets a single column in ~400px, the editor window a
 * narrower rail beside the image. Everything else — the fields, the rules, the
 * wording — is deliberately identical, so the two surfaces cannot drift.
 */
export const PreparationSettings = ({
  inspection,
  settings,
  layout,
  className,
}: {
  readonly inspection: FileInspection;
  readonly settings: Settings;
  readonly layout: "column" | "rail";
  readonly className?: string;
}) => {
  const { values, setValue, setDimension, setLengthUnit, setPreset } = settings;
  const isImage = inspection.kind === "image";
  const outputMimeType =
    values.format === "keep" ? inspection.mimeType : values.format;
  const dpiSupported = canWriteImageDensity(outputMimeType);
  const usingPhysicalUnits = values.lengthUnit !== "px";

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <SelectField
        id="prepare-preset"
        label="Preset"
        value={values.presetId}
        onValueChange={setPreset}
        options={PREPARATION_PRESETS.map((preset) => ({
          value: preset.id,
          label: preset.label,
        }))}
      />

      {isImage && (
        <>
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-2.5">
            <div
              className={cn(
                "grid gap-2",
                layout === "column"
                  ? "grid-cols-[1fr_1fr_auto]"
                  : "grid-cols-2",
              )}
            >
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
                className={layout === "column" ? "w-20" : "col-span-2"}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <CheckboxField
                id="prepare-lock-aspect"
                checked={values.lockAspect}
                onCheckedChange={(checked) => setValue("lockAspect", checked)}
                label={
                  <span className="inline-flex items-center gap-1">
                    {values.lockAspect ? (
                      <Link2 className="size-3.5" />
                    ) : (
                      <Unlink2 className="size-3.5" />
                    )}
                    Lock aspect ratio
                  </span>
                }
              />
              <Input
                id="prepare-ratio"
                aria-label="Aspect ratio"
                className="h-8 w-24 text-xs"
                placeholder="4:5"
                value={values.aspectRatioInput}
                disabled={!values.lockAspect}
                onChange={(event) =>
                  setValue("aspectRatioInput", event.target.value)
                }
              />
            </div>

            {/* The conversion is the whole point of physical units, so show it
                rather than making the user trust it. */}
            {usingPhysicalUnits &&
              (settings.pixelSize.width || settings.pixelSize.height) && (
                <p className="text-muted-foreground text-xs">
                  {values.widthValue || "auto"} × {values.heightValue || "auto"}{" "}
                  {values.lengthUnit} at {Math.round(settings.dpi)} DPI ={" "}
                  {settings.pixelSize.width ?? "auto"} ×{" "}
                  {settings.pixelSize.height ?? "auto"} px
                </p>
              )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <SelectField
              id="prepare-format"
              label="Output format"
              value={values.format}
              onValueChange={(next) => setValue("format", next as OutputFormat)}
              options={FORMAT_OPTIONS}
            />
            <label
              htmlFor="prepare-dpi"
              className="flex min-w-0 flex-col gap-1 text-xs"
            >
              <span className="text-muted-foreground">DPI</span>
              <Input
                id="prepare-dpi"
                type="number"
                min="1"
                inputMode="numeric"
                placeholder={
                  dpiSupported
                    ? inspection.dpi
                      ? `${Math.round(inspection.dpi.x)}`
                      : "Not set"
                    : "Unsupported"
                }
                value={dpiSupported ? values.dpiValue : ""}
                disabled={!dpiSupported}
                onChange={(event) => setValue("dpiValue", event.target.value)}
              />
            </label>
          </div>

          {!dpiSupported && (
            <p className="text-muted-foreground text-xs">
              WebP cannot store a DPI value. Choose JPEG or PNG if the form asks
              for one.
            </p>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 items-end gap-1.5">
          <label
            htmlFor="prepare-max-size"
            className="flex min-w-0 flex-1 flex-col gap-1 text-xs"
          >
            <span className="text-muted-foreground">Max file size</span>
            <Input
              id="prepare-max-size"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="Optional"
              value={values.maxSizeValue}
              onChange={(event) => setValue("maxSizeValue", event.target.value)}
            />
          </label>
          <SelectField
            id="prepare-max-size-unit"
            label=""
            value={values.maxSizeUnit}
            onValueChange={(next) => setValue("maxSizeUnit", next as ByteUnit)}
            options={unitOptions(BYTE_UNITS)}
            className="w-18 shrink-0"
          />
        </div>
        <div className="flex min-w-0 items-end gap-1.5">
          <label
            htmlFor="prepare-min-size"
            className="flex min-w-0 flex-1 flex-col gap-1 text-xs"
          >
            <span className="text-muted-foreground">Min file size</span>
            <Input
              id="prepare-min-size"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="Optional"
              value={values.minSizeValue}
              onChange={(event) => setValue("minSizeValue", event.target.value)}
            />
          </label>
          <SelectField
            id="prepare-min-size-unit"
            label=""
            value={values.minSizeUnit}
            onValueChange={(next) => setValue("minSizeUnit", next as ByteUnit)}
            options={unitOptions(BYTE_UNITS)}
            className="w-18 shrink-0"
          />
        </div>
      </div>

      {inspection.kind === "pdf" && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-2.5">
          <p className="font-medium text-xs">PDF options</p>
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
                onChange={(event) => setValue("pageStart", event.target.value)}
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
                onChange={(event) => setValue("pageEnd", event.target.value)}
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
                onChange={(event) => setValue("pageWidth", event.target.value)}
              />
            </label>
            <label
              htmlFor="prepare-page-height"
              className="flex flex-col gap-1 text-xs"
            >
              <span className="text-muted-foreground">Page height (pt)</span>
              <Input
                id="prepare-page-height"
                type="number"
                min="1"
                placeholder="Keep original"
                value={values.pageHeight}
                onChange={(event) => setValue("pageHeight", event.target.value)}
              />
            </label>
          </div>
        </div>
      )}

      {/* Issues are advisory while typing, not blocking. */}
      {settings.issues.length > 0 && (
        <ul className="flex flex-col gap-1">
          {settings.issues.map((issue) => (
            <li key={issue} className="text-muted-foreground text-xs">
              {issue}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
