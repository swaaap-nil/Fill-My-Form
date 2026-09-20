/**
 * Persists one editor handshake per session id in `chrome.storage.session`,
 * mirroring how `~/lib/agent-runs.ts` persists a run per tab.
 *
 * **Why storage rather than messaging.** `runtime.sendMessage` is
 * point-to-point and rejects with "Could not establish connection" when no
 * receiver exists — and there is no receiver exactly when it matters here. The
 * side panel closes whenever the user clicks another window, which is the
 * first thing opening the editor asks them to do. A result posted to a closed
 * panel would be dropped silently.
 *
 * `storage.session` is instead a rendezvous with the right lifetime: it
 * survives a service-worker restart, is cleared when the browser closes, and
 * `onChanged` fires in every extension context — including a panel that opens
 * *after* the write, so the live path and the reconcile-on-mount path are the
 * same code. Its default access level already covers extension pages, so no
 * `setAccessLevel` call is needed.
 *
 * Only identifiers are stored. The quota is around 10 MB and a photo is not.
 */

import { browser } from "wxt/browser";
import {
  advanceEditorSession,
  type EditorSession,
  type EditorSessionStatus,
  isEditorSession,
  isStaleEditorSession,
} from "~/core/files/editor-session";
import type { PreparationFormValues } from "~/core/files/preparation-form";

const KEY_PREFIX = "file-editor:";

const keyFor = (sessionId: string): string => `${KEY_PREFIX}${sessionId}`;

export const saveEditorSession = async (
  session: EditorSession,
): Promise<void> => {
  await browser.storage.session.set({ [keyFor(session.sessionId)]: session });
};

export const loadEditorSession = async (
  sessionId: string,
): Promise<EditorSession | undefined> => {
  const stored = await browser.storage.session.get(keyFor(sessionId));
  const value = stored[keyFor(sessionId)];
  return isEditorSession(value) ? value : undefined;
};

export const clearEditorSession = async (sessionId: string): Promise<void> => {
  await browser.storage.session.remove(keyFor(sessionId));
};

/**
 * Moves a session on, reading the current record first so a concurrent writer
 * cannot be clobbered — the editor's `pagehide` handler and its Save button
 * can otherwise both fire as the window closes.
 */
export const updateEditorSession = async (
  sessionId: string,
  next: {
    readonly status: EditorSessionStatus;
    readonly values?: PreparationFormValues;
    readonly derivedId?: string;
    readonly reason?: string;
  },
): Promise<EditorSession | undefined> => {
  const current = await loadEditorSession(sessionId);
  if (!current) return undefined;
  const advanced = advanceEditorSession(current, next);
  await saveEditorSession(advanced);
  return advanced;
};

/**
 * Calls back whenever this session changes, in any extension context. Returns
 * an unsubscribe function.
 */
export const watchEditorSession = (
  sessionId: string,
  listener: (session: EditorSession) => void,
): (() => void) => {
  const key = keyFor(sessionId);
  // The global `storage.onChanged` with an area filter, rather than
  // `storage.session.onChanged`: the per-area event is newer and is not
  // reliably surfaced through the extension polyfill, while this one is
  // supported everywhere the extension runs.
  const handler = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName !== "session") return;
    const change = changes[key];
    if (!change) return;
    if (isEditorSession(change.newValue)) listener(change.newValue);
  };
  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
};

/**
 * Clears sessions nothing is coming back for: those already finished, those
 * older than the age backstop, and those whose window has gone. A closed window
 * is the common case — the panel marks the session cancelled from
 * `windows.onRemoved` when it is open to hear it, and this covers when it was
 * not.
 */
export const purgeStaleEditorSessions = async (
  now: number = Date.now(),
): Promise<number> => {
  const all = await browser.storage.session.get(null);
  const doomed: string[] = [];

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    if (!isEditorSession(value)) {
      doomed.push(key);
      continue;
    }
    if (isStaleEditorSession(value, now)) {
      doomed.push(key);
      continue;
    }
    if (value.windowId !== undefined && !(await windowExists(value.windowId))) {
      doomed.push(key);
    }
  }

  if (doomed.length > 0) await browser.storage.session.remove(doomed);
  return doomed.length;
};

/** A rejection means the window is gone, which is the answer we want. */
const windowExists = async (windowId: number): Promise<boolean> => {
  try {
    await browser.windows.get(windowId);
    return true;
  } catch {
    return false;
  }
};
