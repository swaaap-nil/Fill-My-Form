/**
 * The one validation that keeps `PolicyEngine.evaluate` on the critical
 * path rather than beside it.
 *
 * The content script's `fillField` handler (`src/app/content`) calls
 * {@link assertValidFillInstruction} before touching the DOM. It throws —
 * fills nothing — unless `decisionId` is present and non-empty. That
 * `decisionId` is only ever minted by the background after it has actually
 * run policy for this exact field and value (`src/app/background`); no
 * other caller in the codebase constructs one. This file is pure and
 * DOM-free on purpose, so the property is testable without a browser and
 * cannot regress silently behind a browser-only integration test.
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
