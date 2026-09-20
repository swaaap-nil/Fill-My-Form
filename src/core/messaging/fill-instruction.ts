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
  uploadId: z.string().min(1),
});

export type UploadFilePayload = z.infer<typeof uploadFilePayloadSchema>;

export const assertValidFillInstruction = (
  payload: unknown,
): FillFieldPayload => fillFieldPayloadSchema.parse(payload);

export const assertValidUploadInstruction = (
  payload: unknown,
): UploadFilePayload => uploadFilePayloadSchema.parse(payload);
