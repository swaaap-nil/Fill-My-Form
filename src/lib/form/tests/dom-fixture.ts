import { Window } from "happy-dom";

/**
 * Builds a `Document` from an HTML string for extractor tests, via
 * happy-dom — the same library `~/lib/tests/form-page-heuristic.test.ts`
 * already uses for a no-DOM-in-`bun:test` gap. See `docs/testing.md`'s rule
 * for pixel work: this is the DOM-shape equivalent, not a layout engine.
 *
 * happy-dom has no layout engine, so `getBoundingClientRect()` always
 * returns a zero rect — which would make `extract.ts`'s `isInvisible` treat
 * every element as hidden, since it uses that rect as one of its signals.
 * `HTMLElement.prototype.getBoundingClientRect` is patched here to return a
 * plausible non-zero box, *unless* the element's own inline style sets
 * `width:0` and `height:0` — the one shape a test can still opt into to
 * cover the zero-size branch. Real layout (visibility from clipping, CSS
 * frameworks, computed geometry) stays end-to-end in
 * `e2e/extraction.spec.ts`, which drives a real browser.
 *
 * `extract.ts`, `fill.ts` and `verify.ts` also do `instanceof
 * HTMLInputElement` and friends against the *global* constructors, as they
 * may in a real page. Bun has no DOM globals of its own — and where it does
 * have a same-named web-standard global (`Event`, `File`, `Blob`), it is a
 * different realm's class than this window's `HTMLInputElement` expects —
 * so each call registers this window's constructors globally. Safe here
 * because every test's `docFromHtml` + extractor/fill/verify call runs
 * synchronously, with no `await` in between that could let another test's
 * window win the race.
 */
const GLOBAL_DOM_CONSTRUCTORS = [
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
  "HTMLFieldSetElement",
  "HTMLFormElement",
  "HTMLTemplateElement",
  "Document",
  "DocumentFragment",
  "ShadowRoot",
  "Node",
  "Event",
  "CustomEvent",
  "File",
  "Blob",
  "DataTransfer",
] as const;

export const docFromHtml = (html: string): Document => {
  const window = new Window();
  for (const name of GLOBAL_DOM_CONSTRUCTORS) {
    // biome-ignore lint/suspicious/noExplicitAny: bridging happy-dom's window onto Bun's global scope.
    (globalThis as any)[name] = (window as any)[name];
  }

  const proto = window.HTMLElement.prototype as unknown as {
    getBoundingClientRect: () => DOMRect;
  };
  proto.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const style = this.getAttribute("style") ?? "";
    const zeroSized =
      /width:\s*0(px)?\s*(;|$)/.test(style) &&
      /height:\s*0(px)?\s*(;|$)/.test(style);
    const width = zeroSized ? 0 : 100;
    const height = zeroSized ? 0 : 20;
    return {
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON() {
        return this;
      },
    } as DOMRect;
  };

  window.document.body.innerHTML = html;
  return window.document as unknown as Document;
};
