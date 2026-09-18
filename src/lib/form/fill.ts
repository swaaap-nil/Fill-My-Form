import { createBrowserFileUploadAdapter } from "../files/adapters";
import type { FieldElements } from "./extract";

/**
 * Writes one resolved value into one page field.
 *
 * Uses the native-setter-plus-event technique 1a's spike proved against
 * `controlled.html`: a plain `element.value = x` is silently dropped by a
 * React-controlled input, but writing through the *prototype's* setter and
 * then dispatching a bubbling `input` event is not — the framework's own
 * change handler sees it and accepts it into its state.
 *
 * **Scope:** text-like inputs, textareas, `<select>`, and native
 * radio/checkbox groups — all by exact option `value`, resolved upstream
 * against the field's actual options by
 * `~/core/matching/resolve-option` before this ever runs. ARIA widgets
 * whose options only exist in the DOM after an interaction
 * (`controlled.html`'s combobox) are still out of scope here — driving a
 * click-to-select widget is fill-*technique* work of its own, not a value
 * write.
 */

const TEXT_LIKE_TYPES = new Set([
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "search",
]);

const nativeValueSetter = (
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): ((value: string) => void) | undefined => {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;

  return Object.getOwnPropertyDescriptor(proto, "value")?.set?.bind(el);
};

const dispatchChange = (el: Element): void => {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

const nativeCheckedSetter = (
  el: HTMLInputElement,
): ((checked: boolean) => void) | undefined =>
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "checked",
  )?.set?.bind(el);

/**
 * Writes into a radio/checkbox group by finding the member whose `.value`
 * matches — the value already resolved to a real option by
 * `~/core/matching/resolve-option`, never raw memory text. Native radio
 * semantics (shared `name`) uncheck the rest; this is also what frameworks'
 * `Radio`/`Checkbox` components actually listen to (verified against
 * MUI's real `PrivateSwitchBase-input` markup).
 */
const writeOptionGroup = (
  group: readonly Element[],
  value: string,
): boolean => {
  const match = group.find(
    (el): el is HTMLInputElement =>
      el instanceof HTMLInputElement && el.value === value,
  );
  if (!match) return false;

  nativeCheckedSetter(match)?.(true);
  dispatchChange(match);
  return true;
};

/** Returns whether the value was actually written. */
export const writeFieldValue = (
  target: FieldElements,
  value: string,
): boolean => {
  if (Array.isArray(target)) {
    return writeOptionGroup(target as readonly Element[], value);
  }
  const el = target as Element;

  if (el instanceof HTMLSelectElement) {
    const hasOption = Array.from(el.options).some((o) => o.value === value);
    if (!hasOption) return false;

    nativeValueSetter(el)?.(value);
    dispatchChange(el);
    return true;
  }

  if (el instanceof HTMLInputElement) {
    if (!TEXT_LIKE_TYPES.has(el.type)) return false;

    nativeValueSetter(el)?.(value);
    dispatchChange(el);
    return true;
  }

  if (el instanceof HTMLTextAreaElement) {
    nativeValueSetter(el)?.(value);
    dispatchChange(el);
    return true;
  }

  return false;
};

export const uploadFieldFile = (
  target: FieldElements,
  input: {
    readonly name: string;
    readonly mimeType: string;
    readonly bytes: readonly number[];
  },
): boolean => {
  if (Array.isArray(target)) return false;
  const el = target as Element;
  const blob = new Blob([new Uint8Array(input.bytes)], {
    type: input.mimeType,
  });
  return createBrowserFileUploadAdapter().upload(el, {
    ref: {
      kind: "file_ref",
      id: "message-payload",
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: blob.size,
      createdAt: new Date().toISOString(),
    },
    blob,
    name: input.name,
    mimeType: input.mimeType,
    transformed: false,
    originalSizeBytes: blob.size,
  });
};
