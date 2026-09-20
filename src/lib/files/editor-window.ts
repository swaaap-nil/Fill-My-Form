/**
 * Opens the image editor as its own extension window.
 *
 * The side panel is rendered by Chrome in a frame it controls, so nothing the
 * panel draws can escape it — a modal there is still a few hundred pixels wide.
 * A separate window is the only way to give the cropper real room. It is the
 * same extension origin, so it shares the `form-agent-files` IndexedDB and can
 * load the original by id.
 *
 * No new permission is required: `chrome.windows` needs none, and `storage` is
 * already granted.
 */

import { browser } from "wxt/browser";
import { createEditorSession } from "~/core/files/editor-session";
import type { PreparationFormValues } from "~/core/files/preparation-form";
import { loadEditorSession, saveEditorSession } from "./editor-session";

const EDITOR_WIDTH = 1100;
const EDITOR_HEIGHT = 780;

export interface OpenEditorInput {
  readonly originalId: string;
  readonly values: PreparationFormValues;
}

export interface OpenEditorResult {
  readonly sessionId: string;
  readonly windowId?: number;
}

/**
 * Creates the handshake record, then the window. The session is written first
 * so the editor can never load before the record it needs exists.
 *
 * Firefox treats popup dimensions as advisory, so the editor's layout must not
 * depend on getting exactly this size.
 */
export const openPreparationEditor = async (
  input: OpenEditorInput,
): Promise<OpenEditorResult> => {
  const sessionId = crypto.randomUUID();
  await saveEditorSession(
    createEditorSession({
      sessionId,
      originalId: input.originalId,
      values: input.values,
    }),
  );

  const url = browser.runtime.getURL(
    `/editor.html?session=${encodeURIComponent(sessionId)}`,
  );

  try {
    const created = await browser.windows.create({
      url,
      type: "popup",
      width: EDITOR_WIDTH,
      height: EDITOR_HEIGHT,
      focused: true,
    });
    const windowId = created?.id;
    if (windowId !== undefined) {
      const session = await loadEditorSession(sessionId);
      if (session) await saveEditorSession({ ...session, windowId });
    }
    return { sessionId, windowId };
  } catch {
    // Some environments refuse popups. A tab still gives the user the editor.
    const tab = await browser.tabs.create({ url });
    return { sessionId, windowId: tab.windowId };
  }
};

/**
 * Brings an already-open editor forward instead of opening a second one.
 * Returns false when that window has gone, so the caller can open a fresh one.
 */
export const focusPreparationEditor = async (
  windowId: number,
): Promise<boolean> => {
  try {
    await browser.windows.update(windowId, { focused: true });
    return true;
  } catch {
    return false;
  }
};

export const closePreparationEditor = async (
  windowId: number,
): Promise<void> => {
  try {
    await browser.windows.remove(windowId);
  } catch {
    // Already closed, which is the desired state.
  }
};
