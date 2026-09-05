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
 * **Scope for phase 1c's straight-line first fill:** text-like inputs,
 * textareas, and `<select>` by exact option value. Radio/checkbox groups
 * and ARIA widgets (`controlled.html`'s combobox) are not written here —
 * matching a stored value against grouped options or driving a
 * click-to-select widget is fill-*technique* work Phase 2 owns, not
 * something this phase's driver needs to unblock its own gate.
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

/** Returns whether the value was actually written. */
export const writeFieldValue = (
  target: FieldElements,
  value: string,
): boolean => {
  // Radio/checkbox groups: out of scope for this phase's driver — see above.
  if (Array.isArray(target)) return false;
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
