/**
 * Generic signal that a page may contain a fillable form. No site-specific
 * rules — used to trigger background matching (ADR 009).
 */

export type FormPageHeuristicReason =
  | "form_element"
  | "clustered_inputs"
  | "named_inputs";

export interface FormPageHeuristicResult {
  readonly likelyFormPage: boolean;
  readonly reason: FormPageHeuristicReason;
}

const isVisible = (element: Element): boolean => {
  if (element.closest("[hidden], template")) return false;
  const view = element.ownerDocument.defaultView;
  if (!view?.getComputedStyle) return true;
  const style = view.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
};

const isMeaningfulField = (element: Element): boolean => {
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") {
    return isVisible(element);
  }
  if (tag !== "input") return false;

  const input = element as HTMLInputElement;
  if (input.type === "hidden" || input.type === "submit") return false;
  if (input.type === "button" || input.type === "reset") return false;
  if (!isVisible(element)) return false;
  return true;
};

const countMeaningfulFields = (root: ParentNode): number => {
  const nodes = root.querySelectorAll("input, textarea, select");
  let count = 0;
  for (const node of nodes) {
    if (isMeaningfulField(node)) count += 1;
  }
  return count;
};

export const evaluateFormPageHeuristic = (
  doc: Document,
): FormPageHeuristicResult => {
  const forms = doc.querySelectorAll("form");
  for (const form of forms) {
    if (countMeaningfulFields(form) >= 1) {
      return { likelyFormPage: true, reason: "form_element" };
    }
  }

  const fieldCount = countMeaningfulFields(doc.body ?? doc);
  if (fieldCount >= 3) {
    return { likelyFormPage: true, reason: "clustered_inputs" };
  }

  const named = doc.querySelectorAll(
    "input[name]:not([type='hidden']), textarea[name], select[name]",
  );
  let namedVisible = 0;
  for (const node of named) {
    if (isMeaningfulField(node)) namedVisible += 1;
  }
  if (namedVisible >= 2) {
    return { likelyFormPage: true, reason: "named_inputs" };
  }

  return { likelyFormPage: false, reason: "clustered_inputs" };
};
