import { describe, expect, it, mock } from "bun:test";
import { renderHook } from "~/components/memory/tests/render-hook";

mock.module("wxt/browser", () => ({
  browser: { i18n: { getMessage: () => "" } },
}));

const { useDetectionNudge, detectionNudgeEvent } = await import(
  "~/components/fill/use-detection-nudge"
);
const { DETECTION_NUDGE_AUTO_HIDE_MS } = await import(
  "~/components/fill/detection-nudge-banner"
);

const detail = { knownFieldCount: 2, answerCount: 3 };

/** Captures timers on the happy-dom window the hook reads, so tests can fire them by hand. */
const captureTimers = () => {
  const w = globalThis.window as unknown as {
    setTimeout: (fn: () => void, ms: number) => number;
    clearTimeout: (id: number) => void;
  };
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  w.setTimeout = (fn, ms) => {
    const id = nextId++;
    timers.set(id, { fn, ms });
    return id;
  };
  w.clearTimeout = (id) => {
    timers.delete(id);
  };
  return timers;
};

const show = () => {
  window.dispatchEvent(new CustomEvent(detectionNudgeEvent, { detail }));
};

describe("useDetectionNudge", () => {
  it("starts hidden, shows on the detection event, and hides on the first dismiss", async () => {
    const h = await renderHook(() => useDetectionNudge());
    expect(h.result.nudge).toBeNull();

    await h.act(show);
    expect(h.result.nudge).toEqual(detail);

    await h.act(() => h.result.dismiss());
    expect(h.result.nudge).toBeNull();
    h.unmount();
  });

  it("auto-hides after the banner timeout", async () => {
    const h = await renderHook(() => useDetectionNudge());
    const timers = captureTimers();

    await h.act(show);
    const [timer] = [...timers.values()];
    expect(timer?.ms).toBe(DETECTION_NUDGE_AUTO_HIDE_MS);
    expect(h.result.nudge).toEqual(detail);

    await h.act(() => timer?.fn());
    expect(h.result.nudge).toBeNull();
    h.unmount();
  });

  it("restarts the auto-hide timer when a second detection arrives", async () => {
    const h = await renderHook(() => useDetectionNudge());
    const timers = captureTimers();

    await h.act(show);
    await h.act(show);

    expect(timers.size).toBe(1);
    h.unmount();
  });

  it("stops listening and clears the timer on unmount", async () => {
    const h = await renderHook(() => useDetectionNudge());
    const timers = captureTimers();

    await h.act(show);
    h.unmount();

    expect(timers.size).toBe(0);
  });

  it("keeps the banner up with a hint after a failed open, then auto-hides", async () => {
    const h = await renderHook(() => useDetectionNudge());
    const timers = captureTimers();

    await h.act(show);
    expect(h.result.hint).toBe(false);

    await h.act(() => h.result.showOpenHint());
    expect(h.result.nudge).toEqual(detail);
    expect(h.result.hint).toBe(true);
    expect(timers.size).toBe(1);

    await h.act(() => [...timers.values()][0]?.fn());
    expect(h.result.nudge).toBeNull();
    expect(h.result.hint).toBe(false);
    h.unmount();
  });

  it("resets the hint on dismiss", async () => {
    const h = await renderHook(() => useDetectionNudge());
    await h.act(show);
    await h.act(() => h.result.showOpenHint());
    await h.act(() => h.result.dismiss());
    expect(h.result.nudge).toBeNull();
    expect(h.result.hint).toBe(false);
    h.unmount();
  });
});
