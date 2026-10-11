type VisibleControlKind =
  | "password"
  | "explicit_identity"
  | "generic_text"
  | "ancillary"
  | "other";

const IGNORED_INPUT_TYPES = new Set([
  "button",
  "hidden",
  "image",
  "reset",
  "submit",
]);

const GENERIC_TEXT_INPUT_TYPES = new Set(["search", "text"]);

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

const autocompleteTokensOf = (element: Element): readonly string[] =>
  (element.getAttribute("autocomplete") ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const isExplicitIdentityInput = (input: HTMLInputElement): boolean => {
  if (input.type === "email") return true;

  const tokens = autocompleteTokensOf(input);
  return tokens.includes("email") || tokens.includes("username");
};

const visibleInputKind = (input: HTMLInputElement): VisibleControlKind => {
  if (input.disabled || !isVisible(input)) return "ancillary";

  const type = input.type.toLowerCase();
  if (IGNORED_INPUT_TYPES.has(type)) return "ancillary";
  if (type === "password") return "password";
  if (type === "checkbox" || type === "radio") return "ancillary";
  if (isExplicitIdentityInput(input)) return "explicit_identity";
  if (GENERIC_TEXT_INPUT_TYPES.has(type)) return "generic_text";
  return "other";
};

const visibleControlKind = (element: Element): VisibleControlKind => {
  const tag = element.tagName.toLowerCase();
  if (tag === "input") return visibleInputKind(element as HTMLInputElement);
  if (tag === "select" && !(element as HTMLSelectElement).disabled) {
    return isVisible(element) ? "other" : "ancillary";
  }
  if (tag === "textarea" && !(element as HTMLTextAreaElement).disabled) {
    return isVisible(element) ? "other" : "ancillary";
  }
  return "ancillary";
};

/**
 * Detects pages whose visible controls are only credentials. This deliberately
 * uses browser-native field shape instead of labels, page text, title, or URL
 * so it stays language-agnostic and removable from the fill pipeline.
 */
export const isCredentialOnlyPage = (doc: Document): boolean => {
  const controls = Array.from(
    (doc.body ?? doc).querySelectorAll("input, select, textarea"),
  );

  let passwordCount = 0;
  let explicitIdentityCount = 0;
  let genericTextCount = 0;

  for (const control of controls) {
    switch (visibleControlKind(control)) {
      case "password":
        passwordCount += 1;
        break;
      case "explicit_identity":
        explicitIdentityCount += 1;
        break;
      case "generic_text":
        genericTextCount += 1;
        break;
      case "other":
        return false;
      case "ancillary":
        break;
    }
  }

  if (passwordCount === 0) return false;
  if (genericTextCount > 1) return false;
  if (genericTextCount === 1 && explicitIdentityCount > 0) return false;

  return true;
};
