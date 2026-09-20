/**
 * Browser-message shape validation for DOM writes.
 *
 * The content script's `fillField` handler (`src/app/content`) calls
 * {@link assertValidFillInstruction} before touching the DOM. It throws —
 * fills nothing — unless `decisionId` is present and non-empty. The actual
 * policy gate lives in the background worker: `confirmFill` only sends one
 * of these payloads after finding a live, tab-bound pending decision and
 * re-running policy for it. The agent-loop path also sends from the
 * background after its reviewed plan step.
 *
 * Upload bytes travel on the instruction itself. Content scripts cannot
 * read `chrome.storage.session`, so a session-staged `uploadId` cannot be
 * recovered on the page that has to write the file input.
 *
 * This file is pure and DOM-free on purpose: it proves malformed content
 * messages do not write to the page, while the capability and policy checks
 * remain centralized in `src/app/background`.
 */

import { z } from "zod";

/** Opaque, background-issued. Never constructed anywhere else. */
export type DecisionId = string;

export const fillFieldPayloadSchema = z.object({
  decisionId: z.string().min(1, "fillField requires a decisionId"),
  fieldId: z.string().min(1),
  value: z.string(),
});

export type FillFieldPayload = z.infer<typeof fillFieldPayloadSchema>;

export const uploadFilePayloadSchema = z.object({
  decisionId: z.string().min(1, "uploadFile requires a decisionId"),
  fieldId: z.string().min(1),
  // Bytes travel on the message itself. `chrome.storage.session` is not
  // available to content scripts, so a session-staged uploadId can never
  // be read back on the page that has to write the file input.
  upload: z.object({
    name: z.string().min(1),
    mimeType: z.string().min(1),
    bytes: z.array(z.number().int().min(0).max(255)),
  }),
});

export type UploadFilePayload = z.infer<typeof uploadFilePayloadSchema>;

export const assertValidFillInstruction = (
  payload: unknown,
): FillFieldPayload => fillFieldPayloadSchema.parse(payload);

export const assertValidUploadInstruction = (
  payload: unknown,
): UploadFilePayload => uploadFilePayloadSchema.parse(payload);
