import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { evaluateFormPageHeuristic } from "~/lib/form/form-page-heuristic";

const docFromHtml = (html: string) => {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
};

describe("evaluateFormPageHeuristic", () => {
  it("detects a classic form with one visible field", () => {
    const doc = docFromHtml(`
      <form><label>Name<input name="name" /></label></form>
    `);
    expect(
      evaluateFormPageHeuristic(doc as unknown as Document).likelyFormPage,
    ).toBe(true);
  });

  it("ignores pages with only a single stray input", () => {
    const doc = docFromHtml(`<main><input type="search" name="q" /></main>`);
    expect(
      evaluateFormPageHeuristic(doc as unknown as Document).likelyFormPage,
    ).toBe(false);
  });

  it("detects clustered inputs without a form element", () => {
    const doc = docFromHtml(`
      <div>
        <input name="a" />
        <input name="b" />
        <input name="c" />
      </div>
    `);
    expect(
      evaluateFormPageHeuristic(doc as unknown as Document).likelyFormPage,
    ).toBe(true);
  });

  it("ignores hidden fields when counting", () => {
    const doc = docFromHtml(`
      <form>
        <input type="hidden" name="token" value="x" />
        <input name="visible" />
      </form>
    `);
    expect(
      evaluateFormPageHeuristic(doc as unknown as Document).likelyFormPage,
    ).toBe(true);
  });
});
