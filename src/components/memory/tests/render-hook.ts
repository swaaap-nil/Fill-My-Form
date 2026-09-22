import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * A minimal `renderHook`, hand-rolled rather than pulling in
 * `@testing-library/react` for one hook: a `Window` from happy-dom (the
 * same library `dom-fixture.ts` and `form-page-heuristic.test.ts` already
 * use for a no-DOM-in-`bun:test` gap) mounts a harness component that calls
 * the hook and republishes its return value; `react-dom/client` + React's
 * own `act` do the rendering. `check:forbidden-deps` and `docs/testing.md`'s
 * "no Vitest here" both read as "don't reach for new test infra before
 * proving the existing tools can't do it" — this is that proof.
 */

const GLOBAL_DOM_KEYS = [
  "window",
  "document",
  "navigator",
  "Element",
  "HTMLElement",
  "Node",
  "Event",
  "CustomEvent",
] as const;

export interface HookHarness<T> {
  /** The hook's latest return value, after the most recent render/act. */
  readonly result: T;
  act: (fn: () => void | Promise<void>) => Promise<void>;
  unmount: () => void;
}

export const renderHook = async <T>(
  useHook: () => T,
): Promise<HookHarness<T>> => {
  const window = new Window();
  for (const key of GLOBAL_DOM_KEYS) {
    // biome-ignore lint/suspicious/noExplicitAny: bridging happy-dom's window onto Bun's global scope.
    (globalThis as any)[key] = (window as any)[key];
  }
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  let latest: T;
  const Harness = () => {
    latest = useHook();
    return null;
  };

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root: Root = createRoot(container as unknown as Element);

  await act(async () => {
    root.render(React.createElement(Harness));
  });

  return {
    get result() {
      return latest;
    },
    act: async (fn) => {
      await act(async () => {
        await fn();
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
};
