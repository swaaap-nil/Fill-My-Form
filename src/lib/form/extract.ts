/**
 * DOM → `FormIR` extractor.
 *
 * This is an **adapter**: it is the one place allowed to touch `HTMLElement`,
 * `Document` and friends. `src/core/form/types.ts` is the contract; nothing
 * here invents a shape that contract does not already describe.
 *
 * Two extraction depths are produced from the same walk:
 *
 * - {@link extract} returns a `PageObservation` — the cheap `FieldSummary`
 *   projection the agent sees first. This is what deliverable 5's goldens
 *   pin.
 * - {@link extractFull} returns the richer `Form[]` (`FormField` per field:
 *   `nearbyText`, `options`, `constraints`, …), fetched per field on request
 *   per `docs/agent.md`'s progressive disclosure. Nothing in phase 1a wires
 *   this up to a message handler — that is 1c's job — but the label
 *   resolution, grouping and `nearbyText` decisions this phase is
 *   responsible for only show up in this richer shape, so it is golden-
 *   tested too (see `e2e/extraction.spec.ts`).
 *
 * ## Decisions recorded here (see the phase 1a handback for the full record)
 *
 * - **Radio/checkbox grouping.** Controls sharing a `name` and a `type` of
 *   `radio`, or sharing a `name` and a `type` of `checkbox` when there is
 *   more than one, become a single `FormField` with `options` — one control
 *   in the DOM tree does not mean one field in the IR. A lone checkbox
 *   (`terms`) stays a single boolean field.
 * - **Skip list.** `type=hidden`, `type=password`, `disabled`, `readOnly`,
 *   and zero-size/hidden elements are never candidates — excluded before
 *   matching ever sees them, not scored as "unmatched".
 * - **Label resolution order:** `<label for>` → wrapping `<label>` →
 *   `aria-label` → `aria-labelledby` → `<legend>` (grouped controls only) →
 *   nearest preceding sibling text within the same parent → `placeholder`.
 * - **`nearbyText` scope:** siblings within the control's *immediate*
 *   parent, in both directions, stopping at the first sibling that is
 *   itself another control or a `<label>` — not walking to the end of the
 *   parent. Wide enough for `messy.html`'s `fld_7` trailing note (alone in
 *   its row, so the boundary never bites); narrow enough that
 *   `controlled.html`, whose fields are flat siblings of the `<form>` with
 *   no per-field wrapper, does not hand every field the whole page's text.
 * - **Per-page field cap:** {@link MAX_FIELDS_PER_PAGE}. Candidate
 *   collection stops once the cap is hit, so a pathological page is bounded
 *   in cost, not just in reported output.
 * - **ARIA widgets.** A `[role="combobox"]` (`controlled.html`'s custom
 *   country picker) is a candidate too, even though it is a `<div>` and
 *   `FieldKind` has no dedicated member for it — it comes through as
 *   `unknown` with its listbox's options attached, rather than being
 *   invisible to extraction. `docs/form/README.md`'s no-DOM rule keeps this
 *   confined to the one place that already touches the DOM; classifying it
 *   better is a matching-tier problem, not an extraction one.
 *
 * ## Phase 1a's write-technique spike (`controlled.html`), for Phase 2
 *
 * `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set`
 * followed by a bubbling `input` (or `change`, for the strict-format date)
 * event drove three of the four hard controls: the React-style input, the
 * masked phone, and the strict-format date. Verified interactively against
 * this fixture; a plain `el.value =` write is silently dropped on all
 * three, confirming they are genuinely hard.
 *
 * The custom combobox is not drivable that way at all — it is a `<div>`
 * with no `value` property, and only a click on one of its `[role="option"]`
 * children changes the selection. This does **not** need a new
 * `AgentAction` member: `call_tool` already covers arbitrary DOM
 * interaction, so the fix is a new tool (something like `click_option`,
 * registered in `src/core/tools/registry.ts`) for Phase 2 to add, not a
 * widening of the four-member action union in `docs/agent.md`.
 */

import { assignFieldIds } from "../../core/form/field-id";
import type {
  FieldConstraint,
  FieldKind,
  Form,
  FormField,
  FormOption,
  FormSummary,
  PageObservation,
} from "../../core/form/types";
import { FieldKind as Kind } from "../../core/form/types";

/**
 * Chosen with generous headroom over any real form (dozens of fields) while
 * bounding the pathological case. Recorded in the phase 1a handback along
 * with the measured extraction time for a 500-field page.
 */
export const MAX_FIELDS_PER_PAGE = 300;

type Candidate = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const isFormControl = (el: Element): el is Candidate =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLSelectElement ||
  el instanceof HTMLTextAreaElement;

const containsFormControl = (el: Element): boolean =>
  isFormControl(el) || !!el.querySelector("input, select, textarea");

/** Elements with zero layout box, or under a `hidden` ancestor. */
const isInvisible = (el: HTMLElement): boolean => {
  if (el.closest("[hidden]")) return true;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return true;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return style?.display === "none" || style?.visibility === "hidden";
};

const isSkipped = (el: Candidate): boolean => {
  const type = el instanceof HTMLInputElement ? el.type : undefined;
  if (
    type === "button" ||
    type === "hidden" ||
    type === "image" ||
    type === "password" ||
    type === "reset" ||
    type === "submit"
  ) {
    return true;
  }
  if (
    type === "file" &&
    !el.id &&
    !el.name &&
    !el.getAttribute("aria-label") &&
    !el.getAttribute("aria-labelledby") &&
    !el.closest("label")
  ) {
    return true;
  }
  if (el.disabled) return true;
  if ("readOnly" in el && el.readOnly) return true;
  return isInvisible(el);
};

const textOf = (el: Element | null | undefined): string | undefined => {
  const text = el?.textContent?.replace(/\s+/g, " ").trim();
  return text ? text : undefined;
};

const isFileInput = (el: Element): el is HTMLInputElement =>
  el instanceof HTMLInputElement && el.type === "file";

const normaliseUiText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isGenericFilePickerText = (el: Element, text: string): boolean => {
  if (!isFileInput(el)) return false;
  const normalised = normaliseUiText(text);
  return (
    normalised === "choose file" ||
    normalised === "browse" ||
    normalised === "choose file browse" ||
    normalised === "no file chosen"
  );
};

const meaningfulLabelText = (
  el: Element,
  text: string | undefined,
): string | undefined => {
  if (!text) return undefined;
  return isGenericFilePickerText(el, text) ? undefined : text;
};

/** Nearest ancestor `<fieldset>`, if the control is grouped inside one. */
const fieldsetOf = (el: Element): HTMLFieldSetElement | null =>
  el.closest("fieldset");

/**
 * Resolves a label for one standalone control (or one option within a
 * group — see {@link resolveGroupLabel} for the group itself), in the order
 * recorded above.
 */
const resolveLabel = (doc: Document, el: Element): string | undefined => {
  if (el.id) {
    const forLabel = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
    const text = meaningfulLabelText(el, textOf(forLabel));
    if (text) return text;
  }

  const wrapping = el.closest("label");
  const wrappingText = meaningfulLabelText(el, textOf(wrapping));
  if (wrappingText) return wrappingText;

  const ariaLabel = meaningfulLabelText(
    el,
    el.getAttribute("aria-label")?.trim(),
  );
  if (ariaLabel) return ariaLabel;

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = meaningfulLabelText(
      el,
      labelledBy
        .split(/\s+/)
        .map((id) => textOf(doc.getElementById(id)))
        .filter((t): t is string => !!t)
        .join(" "),
    );
    if (text) return text;
  }

  const precedingText = meaningfulLabelText(el, precedingSiblingText(el));
  if (precedingText) return precedingText;

  const ancestorText = precedingAncestorText(el);
  if (ancestorText) return ancestorText;

  return (
    meaningfulLabelText(el, el.getAttribute("placeholder")?.trim()) || undefined
  );
};

/**
 * Resolves a radio/checkbox group's own label — distinct from any one
 * option's label. Feeding the group's first *control* through
 * {@link resolveLabel} is wrong: that control is very often itself wrapped
 * in a `<label>` carrying its own option text (`simple.html`'s "Email"
 * radio), which would win over the fieldset's `<legend>` ("Preferred
 * contact method") despite describing the option, not the group. So a
 * grouped control resolves against its `<fieldset>` — id, aria-label,
 * aria-labelledby, `<legend>`, then the fieldset's own preceding sibling
 * text — and only falls back to the first option's own label when there is
 * no fieldset to ask.
 */
const resolveGroupLabel = (
  doc: Document,
  first: HTMLInputElement,
  members: readonly HTMLInputElement[],
  fieldset: HTMLFieldSetElement | null,
): string | undefined => {
  if (!fieldset) return resolveUnfieldedGroupLabel(doc, first, members);

  if (fieldset.id) {
    const forLabel = doc.querySelector(
      `label[for="${cssEscape(fieldset.id)}"]`,
    );
    const text = textOf(forLabel);
    if (text) return text;
  }

  const ariaLabel = fieldset.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;

  const labelledBy = fieldset.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => textOf(doc.getElementById(id)))
      .filter((t): t is string => !!t)
      .join(" ");
    if (text) return text;
  }

  const legendText = textOf(fieldset.querySelector("legend"));
  if (legendText) return legendText;

  return precedingSiblingText(fieldset);
};

const resolveUnfieldedGroupLabel = (
  doc: Document,
  first: HTMLInputElement,
  members: readonly HTMLInputElement[],
): string | undefined => {
  const common = commonAncestor(members);
  if (common) {
    const memberIds = new Set(members.map((m) => m.id).filter(Boolean));
    const labels = Array.from(common.querySelectorAll("label"));
    for (const label of labels) {
      const htmlFor = label.getAttribute("for");
      if (htmlFor && memberIds.has(htmlFor)) continue;
      if (members.some((member) => label.contains(member))) continue;

      const text = textOf(label);
      if (text) return text;
    }
  }

  return resolveLabel(doc, first);
};

const commonAncestor = (
  elements: readonly Element[],
): HTMLElement | undefined => {
  const [first, ...rest] = elements;
  if (!first) return undefined;

  let candidate = first.parentElement;
  while (candidate) {
    if (rest.every((el) => candidate?.contains(el))) return candidate;
    candidate = candidate.parentElement;
  }

  return undefined;
};

/** Nearest non-empty preceding sibling's text, within the same parent. */
const precedingSiblingText = (el: Element): string | undefined => {
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (!containsFormControl(sibling)) {
      const text = textOf(sibling);
      if (text) return text;
    }
    sibling = sibling.previousElementSibling;
  }
  return undefined;
};

const precedingAncestorText = (el: Element): string | undefined => {
  let child: Element = el;
  let parent = el.parentElement;

  while (
    parent &&
    parent.tagName !== "FORM" &&
    parent.tagName !== "BODY" &&
    parent.tagName !== "HTML"
  ) {
    let sibling = child.previousElementSibling;
    while (sibling) {
      if (!containsFormControl(sibling)) {
        const text = meaningfulLabelText(el, textOf(sibling));
        if (text) return text;
      }
      sibling = sibling.previousElementSibling;
    }

    child = parent;
    parent = parent.parentElement;
  }

  return undefined;
};

/**
 * A sibling that marks the edge of this control's own territory: another
 * control, a `<label>` (almost always that other control's label), a
 * `<button>`, or a `<fieldset>` (a self-contained group with its own
 * controls and its own `<legend>` — `simple.html`'s "Cover note" textarea
 * sits right before the "Preferred contact method" radio group's fieldset,
 * and without this the whole group's rendered text leaks in as this
 * unrelated field's `nearbyText`). `nearbyTextOf` stops at the first one in
 * each direction, rather than walking to the end of the parent — the
 * difference between `messy.html`'s `fld_7` (alone in its row, so the scan
 * naturally stops at the row boundary) and `controlled.html` (every field a
 * direct sibling of every other, where an unbounded scan would hand every
 * field the whole page's text as `nearbyText`).
 */
const isNearbyTextBoundary = (el: Element): boolean =>
  isFormControl(el) ||
  el.tagName === "LABEL" ||
  el.tagName === "BUTTON" ||
  el.tagName === "FIELDSET";

/**
 * Sibling text within the same parent, both directions, stopping at the
 * nearest boundary (see {@link isNearbyTextBoundary}) and excluding the
 * sibling that already supplied `label`.
 */
const nearbyTextOf = (
  el: Element,
  labelSource: string | undefined,
): readonly string[] | undefined => {
  const preceding: string[] = [];
  let sibling = el.previousElementSibling;
  while (sibling && !isNearbyTextBoundary(sibling)) {
    const text = textOf(sibling);
    if (text && text !== labelSource) preceding.unshift(text);
    sibling = sibling.previousElementSibling;
  }

  const following: string[] = [];
  sibling = el.nextElementSibling;
  while (sibling && !isNearbyTextBoundary(sibling)) {
    const text = textOf(sibling);
    if (text && text !== labelSource) following.push(text);
    sibling = sibling.nextElementSibling;
  }

  const texts = [...preceding, ...following];
  return texts.length > 0 ? texts : undefined;
};

const inputKind = (el: Candidate): FieldKind => {
  if (el instanceof HTMLSelectElement) return Kind.SELECT;
  if (el instanceof HTMLTextAreaElement) return Kind.TEXTAREA;

  switch (el.type) {
    case "email":
      return Kind.EMAIL;
    case "tel":
      return Kind.TEL;
    case "url":
      return Kind.URL;
    case "number":
      return Kind.NUMBER;
    case "date":
      return Kind.DATE;
    case "radio":
      return Kind.RADIO;
    case "checkbox":
      return Kind.CHECKBOX;
    case "file":
      return Kind.FILE;
    case "text":
    case "search":
      return Kind.TEXT;
    default:
      return Kind.UNKNOWN;
  }
};

const constraintsOf = (el: Candidate): FieldConstraint[] => {
  const constraints: FieldConstraint[] = [];

  if (el.required) constraints.push({ kind: "required" });

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.minLength >= 0 && el.getAttribute("minlength") !== null) {
      constraints.push({ kind: "minLength", value: el.minLength });
    }
    if (el.maxLength >= 0 && el.getAttribute("maxlength") !== null) {
      constraints.push({ kind: "maxLength", value: el.maxLength });
    }
  }

  if (el instanceof HTMLInputElement) {
    if (el.min !== "")
      constraints.push({ kind: "min", value: numericOrString(el.min) });
    if (el.max !== "")
      constraints.push({ kind: "max", value: numericOrString(el.max) });
    if (el.pattern) constraints.push({ kind: "pattern", value: el.pattern });
    if (el.step && el.step !== "any") {
      const step = Number(el.step);
      if (!Number.isNaN(step)) constraints.push({ kind: "step", value: step });
    }
    if (el.type === "file" && el.accept) {
      constraints.push({
        kind: "accept",
        value: el.accept
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
    }
    if (el.type === "file") {
      const maxFileSize = Number(el.dataset.maxFileSizeBytes);
      if (Number.isFinite(maxFileSize) && maxFileSize > 0) {
        constraints.push({ kind: "maxFileSizeBytes", value: maxFileSize });
      }
    }
  }

  return constraints;
};

const numericOrString = (value: string): number | string => {
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
};

const hasValueOf = (el: Candidate): boolean => {
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") return el.checked;
    if (el.type === "file") return el.files !== null && el.files.length > 0;
    return el.value.trim().length > 0;
  }
  return el.value.trim().length > 0;
};

const descriptionOf = (doc: Document, el: Element): string | undefined => {
  const describedBy = el.getAttribute("aria-describedby");
  if (!describedBy) return undefined;
  return (
    describedBy
      .split(/\s+/)
      .map((id) => textOf(doc.getElementById(id)))
      .filter((t): t is string => !!t)
      .join(" ") || undefined
  );
};

interface GroupedCandidate {
  readonly kind: "single";
  readonly el: Candidate;
}

interface WidgetSingle {
  readonly kind: "widget";
  readonly el: HTMLElement;
}

interface RadioOrCheckboxGroup {
  readonly kind: "group";
  readonly name: string;
  readonly type: "radio" | "checkbox";
  /** The group's first control in document order — always present. */
  readonly first: HTMLInputElement;
  readonly els: HTMLInputElement[];
}

type Grouped = GroupedCandidate | WidgetSingle | RadioOrCheckboxGroup;

const isAriaWidget = (el: Element): el is HTMLElement =>
  el.getAttribute("role") === "combobox";

/**
 * Walks a form's controls in document order, folding radio groups (always)
 * and checkbox groups (when more than one control shares the name) into a
 * single grouped entry. The entry's document position is its first
 * control's position, since that is where a reader first encounters it.
 * ARIA widgets (`[role="combobox"]`) pass through as their own entry.
 */
const groupControls = (elements: readonly Element[]): Grouped[] => {
  const candidates = elements.filter(isFormControl);

  const checkboxNames = new Map<string, number>();
  for (const c of candidates) {
    if (c instanceof HTMLInputElement && c.type === "checkbox" && c.name) {
      checkboxNames.set(c.name, (checkboxNames.get(c.name) ?? 0) + 1);
    }
  }

  const grouped: Grouped[] = [];
  const seenGroupKeys = new Set<string>();

  for (const el of elements) {
    if (isAriaWidget(el)) {
      grouped.push({ kind: "widget", el });
      continue;
    }

    if (!isFormControl(el)) continue;
    const c = el;

    const isRadio =
      c instanceof HTMLInputElement && c.type === "radio" && c.name;
    const isGroupedCheckbox =
      c instanceof HTMLInputElement &&
      c.type === "checkbox" &&
      c.name &&
      (checkboxNames.get(c.name) ?? 0) > 1;

    if (isRadio || isGroupedCheckbox) {
      const input = c as HTMLInputElement;
      const type = input.type as "radio" | "checkbox";
      const key = `${type}:${input.name}`;
      if (seenGroupKeys.has(key)) continue;
      seenGroupKeys.add(key);

      const members = candidates.filter(
        (m): m is HTMLInputElement =>
          m instanceof HTMLInputElement &&
          m.type === type &&
          m.name === input.name,
      );
      grouped.push({
        kind: "group",
        name: input.name,
        type,
        first: input,
        els: members,
      });
    } else {
      grouped.push({ kind: "single", el: c });
    }
  }

  return grouped;
};

const widgetOptionsOf = (
  doc: Document,
  el: HTMLElement,
): readonly FormOption[] | undefined => {
  const controlsId = el.getAttribute("aria-controls");
  const listbox = controlsId ? doc.getElementById(controlsId) : null;
  if (!listbox) return undefined;

  const optionEls = Array.from(listbox.querySelectorAll('[role="option"]'));
  if (optionEls.length === 0) return undefined;

  return optionEls.map((o, i) => ({
    value: o.getAttribute("data-value") ?? String(i),
    label: textOf(o) ?? String(i),
    disabled: o.getAttribute("aria-disabled") === "true" || undefined,
  }));
};

const submitLabelOf = (container: Element): string | undefined => {
  const explicitSubmit = container.querySelector<HTMLElement>(
    'button[type="submit"], input[type="submit"]',
  );
  const implicitButtons = Array.from(
    container.querySelectorAll<HTMLElement>("button:not([type])"),
  ).filter((button) => {
    if (button.getAttribute("aria-pressed") !== null) return false;
    const text = textOf(button);
    return text
      ? /\b(apply|continue|next|save|send|submit)\b/i.test(text)
      : false;
  });
  const submit = explicitSubmit ?? implicitButtons.at(-1);
  if (!submit) return undefined;
  if (submit instanceof HTMLInputElement) return submit.value || undefined;
  return textOf(submit);
};

const isWidgetSkipped = (el: HTMLElement): boolean =>
  el.getAttribute("aria-disabled") === "true" ||
  el.hasAttribute("disabled") ||
  isInvisible(el);

/** What a `FieldId` was derived from — a single element, or a whole group. */
export type FieldElements = Element | readonly Element[];

const extractForm = (
  doc: Document,
  form: Element,
  formIndex: number,
  elementsById?: Map<string, FieldElements>,
): Form => {
  const allElements = Array.from(
    form.querySelectorAll<Element>(
      'input, select, textarea, [role="combobox"]',
    ),
  ).filter((el) =>
    isAriaWidget(el)
      ? !isWidgetSkipped(el)
      : isFormControl(el) && !isSkipped(el),
  );

  const groups = groupControls(allElements);

  const idInputs = groups.map((g) => {
    if (g.kind === "group")
      return { formIndex, name: g.name, domId: undefined };
    return {
      formIndex,
      name: "name" in g.el ? g.el.name || undefined : undefined,
      domId: g.el.id || undefined,
    };
  });
  const ids = assignFieldIds(idInputs);

  const fields: FormField[] = groups
    .slice(0, MAX_FIELDS_PER_PAGE)
    .map((g, i) => {
      const id = ids[i];
      if (id === undefined) {
        throw new Error("unreachable: field-id and group arrays diverged");
      }

      if (elementsById) {
        elementsById.set(id, g.kind === "group" ? g.els : g.el);
      }

      if (g.kind === "group") {
        const fieldset = fieldsetOf(g.first);
        const label = resolveGroupLabel(doc, g.first, g.els, fieldset);
        const options: FormOption[] = g.els.map((el) => ({
          value: el.value,
          label: resolveLabel(doc, el) ?? el.value,
          disabled: el.disabled || undefined,
        }));

        return {
          id,
          kind: g.type === "radio" ? Kind.RADIO : Kind.CHECKBOX,
          label,
          required: g.els.some((el) => el.required),
          hasValue: g.els.some((el) => el.checked),
          name: g.name,
          options,
          constraints: g.els.some((el) => el.required)
            ? [{ kind: "required" }]
            : [],
          disabled: g.els.every((el) => el.disabled),
          readOnly: false,
        };
      }

      if (g.kind === "widget") {
        const label = resolveLabel(doc, g.el);
        return {
          id,
          kind: Kind.UNKNOWN,
          label,
          required: g.el.getAttribute("aria-required") === "true",
          hasValue: !!textOf(g.el),
          name: undefined,
          description: descriptionOf(doc, g.el),
          nearbyText: nearbyTextOf(g.el, label),
          options: widgetOptionsOf(doc, g.el),
          constraints:
            g.el.getAttribute("aria-required") === "true"
              ? [{ kind: "required" }]
              : [],
          disabled: g.el.getAttribute("aria-disabled") === "true",
          readOnly: false,
        };
      }

      const el = g.el;
      const label = resolveLabel(doc, el);
      const nearbyText = nearbyTextOf(el, label);

      return {
        id,
        kind: inputKind(el),
        label,
        required: el.required,
        hasValue: hasValueOf(el),
        name: el.name || undefined,
        placeholder:
          "placeholder" in el ? el.placeholder || undefined : undefined,
        autocomplete:
          "autocomplete" in el ? el.autocomplete || undefined : undefined,
        description: descriptionOf(doc, el),
        nearbyText,
        options:
          el instanceof HTMLSelectElement
            ? Array.from(el.options).map((o) => ({
                value: o.value,
                label: o.text,
                disabled: o.disabled || undefined,
              }))
            : undefined,
        constraints: constraintsOf(el),
        disabled: el.disabled,
        readOnly: "readOnly" in el ? el.readOnly : false,
      };
    });

  return {
    id: String(formIndex),
    name: form.getAttribute("name") || undefined,
    method:
      form instanceof HTMLFormElement && form.method === "get" ? "get" : "post",
    submitLabel: submitLabelOf(form),
    fields,
  };
};

const fallbackFormContainers = (doc: Document): Element[] => {
  const candidates = new Set<HTMLElement>(
    Array.from(doc.querySelectorAll<HTMLElement>('[role="form"]')),
  );
  const submitActions = Array.from(
    doc.querySelectorAll<HTMLElement>(
      'button, input[type="submit"], input[type="button"]',
    ),
  ).filter((el) => !isInvisible(el) && !!textOf(el));

  for (const action of submitActions) {
    let candidate = action.parentElement;
    while (
      candidate &&
      candidate.tagName !== "BODY" &&
      candidate.tagName !== "HTML"
    ) {
      candidates.add(candidate);
      candidate = candidate.parentElement;
    }
  }

  const controlCount = (el: Element): number =>
    Array.from(el.querySelectorAll<Element>("input, select, textarea")).filter(
      (control) => isFormControl(control) && !isSkipped(control),
    ).length;

  const viable = Array.from(candidates).filter((el) => {
    const controls = Array.from(
      el.querySelectorAll<Element>("input, select, textarea"),
    ).filter((control) => isFormControl(control) && !isSkipped(control));
    return controls.length > 0 && !!submitLabelOf(el);
  });

  return viable.filter((candidate) => {
    const candidateControls = controlCount(candidate);
    const hasLargerAncestor = viable.some(
      (other) =>
        other !== candidate &&
        other.contains(candidate) &&
        controlCount(other) > candidateControls,
    );
    const hasEquivalentDescendant = viable.some(
      (other) =>
        other !== candidate &&
        candidate.contains(other) &&
        controlCount(other) === candidateControls,
    );

    return !hasLargerAncestor && !hasEquivalentDescendant;
  });
};

const extractableFormContainers = (doc: Document): Element[] => {
  const forms = Array.from(doc.querySelectorAll("form"));
  return forms.length > 0 ? forms : fallbackFormContainers(doc);
};

/** The richer extraction: full `FormField` detail per field. */
export const extractFull = (doc: Document = document): Form[] =>
  extractableFormContainers(doc).map((form, i) => extractForm(doc, form, i));

export interface ExtractionWithElements {
  readonly forms: readonly Form[];
  /**
   * `FieldId` -> the DOM it was derived from. For a fill step to locate a
   * field, it must be looking at the *same* extraction pass that produced
   * the id — ids are recomputed each call, not stored as DOM attributes —
   * so callers that extract once and fill later (`src/app/content`) must
   * keep this map from that same call, not re-extract in between.
   */
  readonly elements: ReadonlyMap<string, FieldElements>;
}

/**
 * Same extraction as {@link extractFull}, plus the element each `FieldId`
 * came from. Only the content script needs this — goldens and the agent's
 * own observations never touch a live element, per `FormIR`'s "shape, not
 * a DOM handle" rule.
 */
export const extractFullWithElements = (
  doc: Document = document,
): ExtractionWithElements => {
  const elements = new Map<string, FieldElements>();
  const forms = extractableFormContainers(doc).map((form, i) =>
    extractForm(doc, form, i, elements),
  );
  return { forms, elements };
};

const toSummary = (form: Form): FormSummary => ({
  id: form.id,
  name: form.name,
  method: form.method,
  submitLabel: form.submitLabel,
  fields: form.fields.map((f) => ({
    id: f.id,
    kind: f.kind,
    label: f.label,
    required: f.required,
    hasValue: f.hasValue,
  })),
});

/** The cheap `PageObservation` the agent sees at OBSERVE. */
export const extract = (doc: Document = document): PageObservation => ({
  origin: doc.location.origin,
  path: doc.location.pathname,
  title: doc.title,
  forms: extractFull(doc).map(toSummary),
  observedAt: new Date().toISOString(),
});

/** Minimal CSS.escape polyfill scope — avoids a dependency for one call. */
function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
