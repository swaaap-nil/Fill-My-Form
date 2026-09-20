/**
 * The handshake between the side panel and the image editor window.
 *
 * The editor cannot live inside the side panel: Chrome renders the panel in its
 * own frame, so a dialog there is clipped to a few hundred pixels — no use for
 * framing a photo. It runs as a separate extension window instead, which means
 * two documents that must agree on what is being edited and what came back.
 *
 * This module is the rules half, kept free of `browser.*` so the state machine
 * is unit-tested without an extension host. `~/lib/files/editor-session.ts` is
 * the adapter that puts these records in `chrome.storage.session`.
 *
 * **Only identifiers cross.** The original file already lives in the shared
 * IndexedDB, and both documents are the same extension origin, so the session
 * carries its id and never its bytes. A blob URL would not work either — those
 * are scoped to the document that created them and 404 anywhere else.
 */

import type { PreparationFormValues } from "./preparation-form";

export type EditorSessionStatus = "open" | "saved" | "cancelled" | "failed";

export interface EditorSession {
  readonly sessionId: string;
  readonly originalId: string;
  readonly status: EditorSessionStatus;
  /** Round-trips the settings, so the editor opens where the panel left off. */
  readonly values: PreparationFormValues;
  /** The prepared artifact's reference, once the editor has saved one. */
  readonly derivedId?: string;
  readonly reason?: string;
  readonly windowId?: number;
  readonly updatedAt: string;
}

/**
 * How long an `open` session may sit before it is assumed abandoned. The panel
 * normally closes a session itself via `windows.onRemoved`, but it cannot do
 * that while it is closed — and the side panel closes whenever the user clicks
 * another window, which is exactly what opening the editor asks them to do.
 * This is the backstop for the case where both were shut in the wrong order.
 */
export const EDITOR_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

export const isTerminalEditorStatus = (status: EditorSessionStatus): boolean =>
  status !== "open";

export const isStaleEditorSession = (
  session: EditorSession,
  now: number = Date.now(),
  maxAgeMs: number = EDITOR_SESSION_MAX_AGE_MS,
): boolean => {
  if (isTerminalEditorStatus(session.status)) return true;
  const updatedAt = Date.parse(session.updatedAt);
  if (Number.isNaN(updatedAt)) return true;
  return now - updatedAt > maxAgeMs;
};

export const createEditorSession = (input: {
  readonly sessionId: string;
  readonly originalId: string;
  readonly values: PreparationFormValues;
  readonly windowId?: number;
  readonly now?: string;
}): EditorSession => ({
  sessionId: input.sessionId,
  originalId: input.originalId,
  status: "open",
  values: input.values,
  windowId: input.windowId,
  updatedAt: input.now ?? new Date().toISOString(),
});

/**
 * Advances a session, refusing to move one that has already finished. Without
 * that guard the editor's `pagehide` handler would race its own Save and
 * overwrite a good result with "cancelled" — the window closing is the last
 * thing that happens in both cases.
 */
export const advanceEditorSession = (
  session: EditorSession,
  next: {
    readonly status: EditorSessionStatus;
    readonly values?: PreparationFormValues;
    readonly derivedId?: string;
    readonly reason?: string;
    readonly now?: string;
  },
): EditorSession => {
  if (isTerminalEditorStatus(session.status)) return session;
  return {
    ...session,
    status: next.status,
    values: next.values ?? session.values,
    derivedId: next.derivedId ?? session.derivedId,
    reason: next.reason ?? session.reason,
    updatedAt: next.now ?? new Date().toISOString(),
  };
};

/** Narrows a stored value that crossed a process boundary. */
export const isEditorSession = (value: unknown): value is EditorSession => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<EditorSession>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.originalId === "string" &&
    typeof candidate.updatedAt === "string" &&
    (candidate.status === "open" ||
      candidate.status === "saved" ||
      candidate.status === "cancelled" ||
      candidate.status === "failed") &&
    typeof candidate.values === "object" &&
    candidate.values !== null
  );
};
