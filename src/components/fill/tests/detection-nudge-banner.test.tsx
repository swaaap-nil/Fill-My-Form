import { describe, expect, it, mock } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

mock.module("wxt/browser", () => ({
  browser: { i18n: { getMessage: () => "" } },
}));

const { DetectionNudgeBanner } = await import(
  "~/components/fill/detection-nudge-banner"
);

const mount = async (
  onReview: () => void,
  onDismiss: () => void,
  hint = false,
) => {
  const window = new Window();
  for (const key of [
    "window",
    "document",
    "navigator",
    "Element",
    "HTMLElement",
    "Node",
    "Event",
  ] as const) {
    // biome-ignore lint/suspicious/noExplicitAny: bridging happy-dom onto Bun's globals.
    (globalThis as any)[key] = (window as any)[key];
  }
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(
      React.createElement(DetectionNudgeBanner, {
        knownFieldCount: 2,
        answerCount: 3,
        hint,
        onReview,
        onDismiss,
      }),
    );
  });
  return container;
};

const click = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(
      new (globalThis as never as { Event: typeof Event }).Event("click", {
        bubbles: true,
      }),
    );
  });
};

const buttons = (c: { querySelectorAll: Element["querySelectorAll"] }) =>
  Array.from(c.querySelectorAll("button"));

describe("DetectionNudgeBanner", () => {
  it("calls onReview when Review is clicked, and not onDismiss", async () => {
    const onReview = mock(() => {});
    const onDismiss = mock(() => {});
    const c = await mount(onReview, onDismiss);

    const review = buttons(c).find((b) => b.textContent === "Review");
    expect(review).toBeDefined();
    await click(review as Element);

    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("calls onDismiss from both the Dismiss link and the × button", async () => {
    const onReview = mock(() => {});
    const onDismiss = mock(() => {});
    const c = await mount(onReview, onDismiss);

    const all = buttons(c);
    await click(all.find((b) => b.textContent === "Dismiss") as Element);
    await click(all.find((b) => b.textContent === "×") as Element);

    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(onReview).not.toHaveBeenCalled();
  });

  it("in hint mode, shows the toolbar-icon message and hides Review but keeps Dismiss", async () => {
    const c = await mount(
      () => {},
      () => {},
      true,
    );

    expect(c.textContent).toContain("toolbar");
    expect(buttons(c).some((b) => b.textContent === "Review")).toBe(false);
    expect(buttons(c).some((b) => b.textContent === "Dismiss")).toBe(true);
  });
});
