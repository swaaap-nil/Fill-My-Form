import { describe, expect, it } from "bun:test";
import {
  advanceEditorSession,
  createEditorSession,
  EDITOR_SESSION_MAX_AGE_MS,
  type EditorSession,
  isEditorSession,
  isStaleEditorSession,
  isTerminalEditorStatus,
} from "~/core/files/editor-session";
import { emptyPreparationFormValues } from "~/core/files/preparation-form";

const session = (overrides: Partial<EditorSession> = {}): EditorSession => ({
  ...createEditorSession({
    sessionId: "session-1",
    originalId: "original-1",
    values: emptyPreparationFormValues,
    now: "2026-09-19T12:00:00.000Z",
  }),
  ...overrides,
});

describe("createEditorSession", () => {
  it("starts open and carries only identifiers", () => {
    const created = session();
    expect(created.status).toBe("open");
    expect(created.originalId).toBe("original-1");
    expect(created.derivedId).toBeUndefined();
  });

  it("round-trips the panel's settings so the editor opens where it left off", () => {
    const created = session({
      values: { ...emptyPreparationFormValues, widthValue: "413" },
    });
    expect(created.values.widthValue).toBe("413");
  });
});

describe("advanceEditorSession", () => {
  it("records a saved result", () => {
    const saved = advanceEditorSession(session(), {
      status: "saved",
      derivedId: "derived-1",
      now: "2026-09-19T12:01:00.000Z",
    });
    expect(saved.status).toBe("saved");
    expect(saved.derivedId).toBe("derived-1");
    expect(saved.updatedAt).toBe("2026-09-19T12:01:00.000Z");
  });

  it("refuses to move a session that already finished", () => {
    // The editor's pagehide handler and its Save button both fire as the
    // window closes. Without this guard the cancel would overwrite the save.
    const saved = advanceEditorSession(session(), {
      status: "saved",
      derivedId: "derived-1",
    });
    const afterClose = advanceEditorSession(saved, { status: "cancelled" });
    expect(afterClose.status).toBe("saved");
    expect(afterClose.derivedId).toBe("derived-1");
    expect(afterClose).toBe(saved);
  });

  it("keeps a cancellation cancelled", () => {
    const cancelled = advanceEditorSession(session(), { status: "cancelled" });
    expect(
      advanceEditorSession(cancelled, { status: "saved", derivedId: "x" })
        .status,
    ).toBe("cancelled");
  });

  it("carries a failure reason", () => {
    const failed = advanceEditorSession(session(), {
      status: "failed",
      reason: "The crop could not be rendered.",
    });
    expect(failed.reason).toBe("The crop could not be rendered.");
  });
});

describe("isTerminalEditorStatus", () => {
  it("treats everything but open as finished", () => {
    expect(isTerminalEditorStatus("open")).toBe(false);
    expect(isTerminalEditorStatus("saved")).toBe(true);
    expect(isTerminalEditorStatus("cancelled")).toBe(true);
    expect(isTerminalEditorStatus("failed")).toBe(true);
  });
});

describe("isStaleEditorSession", () => {
  const openedAt = Date.parse("2026-09-19T12:00:00.000Z");

  it("keeps a fresh open session", () => {
    expect(isStaleEditorSession(session(), openedAt + 1000)).toBe(false);
  });

  it("expires an open session left too long", () => {
    // The backstop for when the panel was closed and could not hear
    // windows.onRemoved — which is the normal case, since opening the editor
    // asks the user to click away from the panel.
    expect(
      isStaleEditorSession(session(), openedAt + EDITOR_SESSION_MAX_AGE_MS + 1),
    ).toBe(true);
  });

  it("treats a finished session as collectable immediately", () => {
    const saved = advanceEditorSession(session(), { status: "saved" });
    expect(isStaleEditorSession(saved, openedAt)).toBe(true);
  });

  it("treats an unparseable timestamp as stale rather than immortal", () => {
    expect(
      isStaleEditorSession(session({ updatedAt: "not a date" }), openedAt),
    ).toBe(true);
  });
});

describe("isEditorSession", () => {
  it("accepts a well-formed record", () => {
    expect(isEditorSession(session())).toBe(true);
  });

  it("rejects anything else that crossed the process boundary", () => {
    for (const value of [
      null,
      undefined,
      "session",
      42,
      {},
      { sessionId: "a" },
      { ...session(), status: "weird" },
      { ...session(), values: null },
      { ...session(), sessionId: 1 },
    ]) {
      expect(isEditorSession(value)).toBe(false);
    }
  });
});
