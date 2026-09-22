import { describe, expect, it, mock } from "bun:test";

/**
 * Hook-level coverage for `useMemoryAutosave`'s snapshot-load wiring — the
 * part `snapshot-merge.test.ts` cannot reach, since that file only proves
 * the pure merge functions in isolation. This proves the hook actually
 * calls them with the right arguments at the right times: a value typed
 * while `getMemorySnapshot` is still in flight must survive the snapshot
 * landing, and a failed load must not wipe state out from under an edit in
 * progress. See `render-hook.ts` for why this is a hand-rolled harness
 * rather than a new test-library dependency.
 *
 * `~/lib/messaging` is mocked, not real: importing it unmocked throws
 * outside an actual extension context (`~/lib/form/verify.ts`'s file
 * comment explains why — the `webextension-polyfill` it pulls in refuses to
 * load outside `chrome.runtime`). `mock.module` must run before the hook
 * module is imported, so each test dynamically imports both after setting
 * up its own mock — `supabase.test.ts` uses the same pattern for the same
 * reason.
 */

interface FakeSnapshotItem {
  readonly key: string;
  readonly value: string;
}

const setUpMessaging = () => {
  const pending: Array<{
    resolve: (v: { items: FakeSnapshotItem[] }) => void;
    reject: (e: unknown) => void;
  }> = [];

  const sendMessage = mock((type: string) => {
    if (type === "getMemorySnapshot") {
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    }
    // recordOnboardingAnswer / deleteOnboardingAnswer and anything else:
    // these tests never let the debounce timer fire, so this path is
    // unreached, but a hung promise would make an errant call hang the
    // test instead of failing it loudly.
    return Promise.resolve({ ok: true });
  });

  mock.module("~/lib/messaging", () => ({ sendMessage }));

  return {
    sendMessage,
    /** Resolves the Nth (0-indexed) `getMemorySnapshot` call in call order. */
    resolveSnapshot: (index: number, items: FakeSnapshotItem[]) =>
      pending[index]?.resolve({ items }),
    rejectSnapshot: (index: number, error: unknown) =>
      pending[index]?.reject(error),
  };
};

describe("useMemoryAutosave: snapshot-load race", () => {
  it("keeps a value typed while the initial snapshot load is still in flight", async () => {
    const { resolveSnapshot } = setUpMessaging();
    const { renderHook } = await import("./render-hook");
    const { useMemoryAutosave } = await import(
      "~/components/memory/use-memory-autosave"
    );

    const harness = await renderHook(() => useMemoryAutosave());

    await harness.act(() => {
      harness.result.updateTextField(
        "contact.email",
        "typed@example.com",
        "Email",
      );
    });
    expect(harness.result.values["contact.email"]).toBe("typed@example.com");

    // The snapshot lands with different, stale data for the same key.
    await harness.act(async () => {
      resolveSnapshot(0, [
        { key: "contact.email", value: "stale@example.com" },
      ]);
    });

    expect(harness.result.values["contact.email"]).toBe("typed@example.com");
    harness.unmount();
  });

  it("lets the snapshot set a key the user never touched", async () => {
    const { resolveSnapshot } = setUpMessaging();
    const { renderHook } = await import("./render-hook");
    const { useMemoryAutosave } = await import(
      "~/components/memory/use-memory-autosave"
    );

    const harness = await renderHook(() => useMemoryAutosave());
    await harness.act(async () => {
      resolveSnapshot(0, [
        { key: "contact.email", value: "stored@example.com" },
      ]);
    });

    expect(harness.result.values["contact.email"]).toBe("stored@example.com");
    expect(harness.result.savedCount).toBe(1);
    harness.unmount();
  });

  it("only applies the latest of two overlapping loads (loadVersion supersedes the stale one)", async () => {
    const { resolveSnapshot } = setUpMessaging();
    const { renderHook } = await import("./render-hook");
    const { useMemoryAutosave } = await import(
      "~/components/memory/use-memory-autosave"
    );

    const harness = await renderHook(() => useMemoryAutosave());
    // Call #0 fired on mount; this fires call #1 before #0 has resolved.
    await harness.act(() => {
      harness.result.reload();
    });

    await harness.act(async () => {
      resolveSnapshot(0, [{ key: "a", value: "FIRST-STALE" }]);
    });
    expect(harness.result.values.a).toBeUndefined();

    await harness.act(async () => {
      resolveSnapshot(1, [{ key: "a", value: "SECOND-FRESH" }]);
    });
    expect(harness.result.values.a).toBe("SECOND-FRESH");
    harness.unmount();
  });
});

describe("useMemoryAutosave: a failed snapshot load", () => {
  it("does not reset the status of a field the user is actively editing", async () => {
    const { rejectSnapshot } = setUpMessaging();
    const { renderHook } = await import("./render-hook");
    const { useMemoryAutosave } = await import(
      "~/components/memory/use-memory-autosave"
    );

    const harness = await renderHook(() => useMemoryAutosave());
    await harness.act(() => {
      harness.result.updateTextField(
        "contact.email",
        "typed@example.com",
        "Email",
      );
    });
    expect(harness.result.getStatus("contact.email")).toBe("pending");

    await harness.act(async () => {
      rejectSnapshot(0, new Error("network down"));
    });

    expect(harness.result.getStatus("contact.email")).toBe("pending");
    expect(harness.result.values["contact.email"]).toBe("typed@example.com");
    harness.unmount();
  });

  it("resets the status of a field not being edited (no error state stuck forever)", async () => {
    const { rejectSnapshot } = setUpMessaging();
    const { renderHook } = await import("./render-hook");
    const { useMemoryAutosave } = await import(
      "~/components/memory/use-memory-autosave"
    );

    const harness = await renderHook(() => useMemoryAutosave());
    await harness.act(async () => {
      rejectSnapshot(0, new Error("network down"));
    });

    expect(harness.result.getStatus("contact.email")).toBe("idle");
    harness.unmount();
  });
});
