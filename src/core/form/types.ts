/**
 * FormIR — the normalised representation of a web form.
 *
 * Two rules define this module:
 *
 * 1. No DOM. Nothing here references `HTMLElement`, `Document` or `Window`.
 *    The browser adapter (content script) produces a FormIR; the agent only
 *    ever sees the FormIR. That keeps the domain testable in plain Bun and
 *    keeps raw page access away from the model.
 *
 * 2. Shape, not content. A `FormField` describes what a field *is* — kind,
 *    label, constraints, options — and never carries what the user has typed
 *    into it. `hasValue` is the only signal about current content. Reading a
 *    value back is an explicit, separately authorised act performed by the
 *    verification step, not something that rides along in every observation.
 */

export type FormId = string;
export type FieldId = string;

export const FieldKind = {
  TEXT: "text",
  EMAIL: "email",
  TEL: "tel",
  URL: "url",
  NUMBER: "number",
  DATE: "date",
  TEXTAREA: "textarea",
  SELECT: "select",
  RADIO: "radio",
  CHECKBOX: "checkbox",
  FILE: "file",
  PASSWORD: "password",
  HIDDEN: "hidden",
  UNKNOWN: "unknown",
} as const;

export type FieldKind = (typeof FieldKind)[keyof typeof FieldKind];

export interface FormOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

/** Validation rules declared by the page itself. Deterministic, no inference. */
export type FieldConstraint =
  | { readonly kind: "required" }
  | { readonly kind: "minLength"; readonly value: number }
  | { readonly kind: "maxLength"; readonly value: number }
  | { readonly kind: "min"; readonly value: number | string }
  | { readonly kind: "max"; readonly value: number | string }
  | { readonly kind: "pattern"; readonly value: string }
  | { readonly kind: "step"; readonly value: number }
  /** `accept` on a file input, e.g. [".pdf", "image/*"]. */
  | { readonly kind: "accept"; readonly value: readonly string[] }
  | {
      readonly kind: "dimensions";
      readonly value: { readonly width: number; readonly height: number };
      readonly bound: "min" | "max";
    }
  | {
      readonly kind: "aspectRatio";
      readonly value: { readonly min: number; readonly max: number };
    }
  | {
      readonly kind: "fileSizeRangeBytes";
      readonly value: { readonly min?: number; readonly max?: number };
    }
  | {
      readonly kind: "occupancyPercent";
      readonly value: { readonly min: number; readonly max: number };
    }
  | { readonly kind: "maxFileSizeBytes"; readonly value: number };

export type UploadIntentKind = "photo" | "signature" | "document" | "unknown";
export type UploadIntentConfidence = "high" | "medium" | "low";
export type UploadActionability =
  | "automatic"
  | "user_assisted"
  | "information_only";

/** A visible upload requirement, including custom controls without file inputs. */
export interface UploadIntent {
  readonly id: string;
  readonly kind: UploadIntentKind;
  readonly label?: string;
  readonly description?: string;
  readonly requirements: readonly string[];
  readonly constraints: readonly FieldConstraint[];
  readonly confidence: UploadIntentConfidence;
  readonly actionability: UploadActionability;
  readonly hasNativeTarget: boolean;
}

/**
 * The cheap projection handed to the agent first. Progressive disclosure
 * starts here; richer detail is fetched per field on request.
 * See docs/agent.md.
 */
export interface FieldSummary {
  readonly id: FieldId;
  readonly kind: FieldKind;
  /** Best available human label, if one was found deterministically. */
  readonly label?: string;
  readonly required: boolean;
  readonly hasValue: boolean;
}

/** The full picture for one field, fetched on demand. */
export interface FormField extends FieldSummary {
  readonly name?: string;
  readonly placeholder?: string;
  readonly autocomplete?: string;
  /** Text resolved from aria-describedby / adjacent help text. */
  readonly description?: string;
  /** Visible text near the control, used when no label is associated. */
  readonly nearbyText?: readonly string[];
  /** Present for select / radio / checkbox groups. */
  readonly options?: readonly FormOption[];
  readonly constraints: readonly FieldConstraint[];
  readonly disabled: boolean;
  readonly readOnly: boolean;
}

export interface FormSummary {
  readonly id: FormId;
  readonly name?: string;
  readonly method?: "get" | "post";
  readonly submitLabel?: string;
  readonly fields: readonly FieldSummary[];
  readonly uploadIntents?: readonly UploadIntent[];
}

export interface Form extends Omit<FormSummary, "fields"> {
  readonly fields: readonly FormField[];
  readonly uploadIntents?: readonly UploadIntent[];
  /** Primary language subtag declared by the page (from `<html lang>`), e.g. "en", "hi", "es". */
  readonly documentLocale?: string;
}

/**
 * What the agent sees of the page at OBSERVE. Deliberately thin: an origin
 * rather than a full URL, a title, and form outlines. Not the DOM, not the
 * page text.
 */
export interface PageObservation {
  /** Registrable origin, e.g. "https://example.com". Never a query string. */
  readonly origin: string;
  readonly path: string;
  readonly title: string;
  readonly forms: readonly FormSummary[];
  readonly observedAt: string;
}

export const isRequired = (field: FormField): boolean =>
  field.required || field.constraints.some((c) => c.kind === "required");
