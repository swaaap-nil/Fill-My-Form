import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import {
  isCredentialOnlyPage,
  shouldSuppressProactiveDetection,
} from "~/lib/proactive-suppression";

const docFromHtml = (html: string): Document => {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as Document;
};

describe("isCredentialOnlyPage", () => {
  it("suppresses email and password forms", () => {
    const doc = docFromHtml(`
      <form>
        <input type="email" autocomplete="email">
        <input type="password" autocomplete="current-password">
        <button type="submit">Continue</button>
      </form>
    `);

    expect(isCredentialOnlyPage(doc)).toBe(true);
  });

  it("suppresses username and password forms", () => {
    const doc = docFromHtml(`
      <form>
        <input autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
    `);

    expect(isCredentialOnlyPage(doc)).toBe(true);
  });

  it("suppresses a credential form with a remember checkbox", () => {
    const doc = docFromHtml(`
      <form>
        <input autocomplete="username">
        <input type="password">
        <label><input type="checkbox"> Remember this browser</label>
      </form>
    `);

    expect(isCredentialOnlyPage(doc)).toBe(true);
  });

  it("does not need English labels to suppress credential-only pages", () => {
    const doc = docFromHtml(`
      <form>
        <label>Correo electronico<input type="email"></label>
        <label>Contrasena<input type="password"></label>
      </form>
    `);

    expect(isCredentialOnlyPage(doc)).toBe(true);
  });

  it("does not suppress broader forms with profile fields", () => {
    const doc = docFromHtml(`
      <form>
        <input name="full_name">
        <input type="email" autocomplete="email">
        <input type="password" autocomplete="new-password">
      </form>
    `);

    expect(isCredentialOnlyPage(doc)).toBe(false);
  });

  it("does not suppress normal forms without passwords", () => {
    const doc = docFromHtml(`
      <form>
        <input type="email" autocomplete="email">
        <textarea name="message"></textarea>
      </form>
    `);

    expect(isCredentialOnlyPage(doc)).toBe(false);
  });
});

describe("shouldSuppressProactiveDetection", () => {
  it("can disable credential-only suppression from config", () => {
    const doc = docFromHtml(`
      <form>
        <input type="email">
        <input type="password">
      </form>
    `);

    expect(
      shouldSuppressProactiveDetection(doc, { credentialOnlyPages: false }),
    ).toBe(false);
  });
});
