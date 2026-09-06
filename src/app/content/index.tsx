import ReactDOM from "react-dom/client";
import { browser } from "wxt/browser";
import { createShadowRootUi, defineContentScript } from "#imports";
import { Logo } from "@/components/common/logo";
import type { FieldElements } from "~/lib/form/extract";
import { extractFullWithElements } from "~/lib/form/extract";
import { uploadFieldFile, writeFieldValue } from "~/lib/form/fill";
import { compareFieldValue } from "~/lib/form/verify";
import {
  assertValidFillInstruction,
  assertValidUploadInstruction,
  onMessage,
} from "~/lib/messaging";

import "~/assets/styles/globals.css";

/**
 * Populated by the most recent `extractFullForm` message, consumed by
 * `fillField`. `FieldId`s are recomputed on every extraction rather than
 * stored as DOM attributes (see `~/core/form/field-id`), so a fill must
 * target the same extraction pass that produced the id it was given —
 * hence caching it here rather than re-extracting inside `fillField`.
 */
let lastElementsById: ReadonlyMap<string, FieldElements> = new Map();

const readStagedUpload = async (
  uploadId: string,
): Promise<{
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: readonly number[];
} | null> => {
  const key = `file-upload:${uploadId}`;
  const record = (await browser.storage.session.get(key))[key];
  await browser.storage.session.remove(key);
  if (!record || typeof record !== "object") return null;
  const upload = record as {
    readonly name?: unknown;
    readonly mimeType?: unknown;
    readonly bytes?: unknown;
  };
  if (
    typeof upload.name !== "string" ||
    typeof upload.mimeType !== "string" ||
    !Array.isArray(upload.bytes) ||
    !upload.bytes.every((byte) => typeof byte === "number")
  ) {
    return null;
  }
  return {
    name: upload.name,
    mimeType: upload.mimeType,
    bytes: upload.bytes,
  };
};

const registerFillHandlers = () => {
  onMessage("extractFullForm", () => {
    const { forms, elements } = extractFullWithElements(document);
    lastElementsById = elements;
    return { forms };
  });

  onMessage("fillField", ({ data }) => {
    // Throws — fills nothing — without a `decisionId`. See
    // ~/core/messaging/fill-instruction for why this must stay here.
    const { fieldId, value } = assertValidFillInstruction(data);

    const target = lastElementsById.get(fieldId);
    if (!target) return { ok: false };

    return { ok: writeFieldValue(target, value) };
  });

  onMessage("uploadFile", async ({ data }) => {
    const { fieldId, uploadId } = assertValidUploadInstruction(data);
    const target = lastElementsById.get(fieldId);
    if (!target) return { ok: false };
    const upload = await readStagedUpload(uploadId);
    if (!upload) return { ok: false };

    return { ok: uploadFieldFile(target, upload) };
  });

  onMessage("verifyField", ({ data }) => {
    // Same cache `fillField` reads: a verify must check the same element the
    // fill wrote to, from the same extraction pass a `FieldId` came from.
    return compareFieldValue(
      lastElementsById.get(data.fieldId),
      data.expectedValue,
    );
  });
};

/**
 * `registration: "runtime"` keeps this script OUT of the manifest.
 *
 * A declared content script matching `<all_urls>` grants code injection into
 * every page at install time — which would undo the narrow permissions in
 * `wxt.config.ts` and show the user "read and change all your data on all
 * websites" regardless. Instead the background worker registers this script
 * for a specific origin once the user grants access to that site.
 *
 * See docs/privacy.md. `matches` below is the *upper bound* of what may ever
 * be registered, not what is granted.
 */
const ContentScriptUI = () => (
  <div className="pointer-events-none fixed right-4 bottom-4 flex items-center gap-2 rounded-lg bg-background/90 px-3 py-2 text-foreground text-sm shadow-lg ring-1 ring-border">
    <Logo className="w-4 text-primary" />
    <span>{browser.i18n.getMessage("contentScriptActive")}</span>
  </div>
);

export default defineContentScript({
  matches: ["https://*/*", "http://*/*"],
  registration: "runtime",
  cssInjectionMode: "ui",

  async main(ctx) {
    registerFillHandlers();

    const ui = await createShadowRootUi(ctx, {
      name: "form-agent-ui",
      position: "overlay",
      anchor: "body",
      onMount: (container) => {
        const app = document.createElement("div");
        container.append(app);

        const root = ReactDOM.createRoot(app);
        root.render(<ContentScriptUI />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
