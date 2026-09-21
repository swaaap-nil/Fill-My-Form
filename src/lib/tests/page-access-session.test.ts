import { describe, expect, it } from "bun:test";
import {
  createPageAccessSession,
  PAGE_ACCESS_REVOKED_ATTR,
} from "~/lib/page-access-session";

const createRoot = () => {
  const attrs = new Set<string>();
  return {
    hasAttribute: (name: string) => attrs.has(name),
    setAttribute: (name: string) => {
      attrs.add(name);
    },
    removeAttribute: (name: string) => {
      attrs.delete(name);
    },
  };
};

describe("createPageAccessSession", () => {
  it("starts allowed and no-ops after revoke", () => {
    const session = createPageAccessSession();
    expect(session.isRevoked()).toBe(false);

    session.revoke();
    expect(session.isRevoked()).toBe(true);
  });

  it("shares revoke state through the document root across sessions", () => {
    const root = createRoot();
    const first = createPageAccessSession(root);
    const second = createPageAccessSession(root);

    first.revoke();
    expect(second.isRevoked()).toBe(true);
    expect(root.hasAttribute(PAGE_ACCESS_REVOKED_ATTR)).toBe(true);

    second.restore();
    expect(first.isRevoked()).toBe(false);
  });
});
