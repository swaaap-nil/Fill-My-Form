import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { FieldStatus } from "./use-memory-autosave";

const EXPECTS_TO_INPUT_TYPE: Record<string, string> = {
  email: "email",
  tel: "tel",
  url: "url",
  number: "number",
  date: "date",
};

export const inputTypeFor = (expects: string): string =>
  EXPECTS_TO_INPUT_TYPE[expects] ?? "text";

const STATUS_LABELS: Record<Exclude<FieldStatus, "idle">, string> = {
  pending: "Waiting to save",
  saving: "Saving",
  saved: "Saved",
  error: "Save failed",
};

export const AutosaveStatusIcon = ({
  fieldKey,
  status,
}: {
  readonly fieldKey: string;
  readonly status: FieldStatus;
}) => {
  if (status === "idle") return null;

  return (
    <span
      aria-label={STATUS_LABELS[status]}
      className="pointer-events-none absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-muted-foreground"
      data-testid={`autosave-status-${fieldKey}`}
      role="img"
    >
      {status === "pending" || status === "saving" ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : status === "saved" ? (
        <Check className="size-3.5 text-primary" />
      ) : (
        <AlertCircle className="size-3.5 text-destructive" />
      )}
    </span>
  );
};

export const AutosaveTextField = ({
  fieldKey,
  label,
  showLabel = true,
  expects = "text",
  value,
  status,
  onChange,
}: {
  readonly fieldKey: string;
  readonly label: string;
  readonly showLabel?: boolean;
  readonly expects?: string;
  readonly value: string;
  readonly status: FieldStatus;
  readonly onChange: (value: string) => void;
}) => (
  <div className="flex flex-col gap-1">
    {showLabel ? <Label htmlFor={fieldKey}>{label}</Label> : null}
    <div className="relative">
      <Input
        className="pr-9"
        id={fieldKey}
        type={inputTypeFor(expects)}
        value={value}
        aria-label={showLabel ? undefined : label}
        placeholder={showLabel ? undefined : label}
        onChange={(event) => onChange(event.target.value)}
      />
      <AutosaveStatusIcon fieldKey={fieldKey} status={status} />
    </div>
  </div>
);
