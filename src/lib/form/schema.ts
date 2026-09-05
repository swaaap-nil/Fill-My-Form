import { z } from "zod";

/**
 * Runtime validation for `Form`/`FormField`, mirroring `~/core/form/types`.
 *
 * `~/core/tools/registry`'s `executeTool` validates every tool's output
 * against a Zod schema before the runtime trusts it — "a misbehaving adapter
 * must not be able to widen what the agent believes it received." The
 * content script is our own code, not a model, but it is still the far side
 * of a message-passing boundary, and this is the one place that boundary's
 * shape is checked rather than assumed. Kept in `src/lib` (an adapter
 * concern) rather than `src/core`, which stays free of validation schemas
 * for its own plain-TypeScript contracts.
 */

const fieldKindSchema = z.enum([
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "file",
  "password",
  "hidden",
  "unknown",
]);

const formOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  disabled: z.boolean().optional(),
});

const fieldConstraintSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("required") }),
  z.object({ kind: z.literal("minLength"), value: z.number() }),
  z.object({ kind: z.literal("maxLength"), value: z.number() }),
  z.object({
    kind: z.literal("min"),
    value: z.union([z.number(), z.string()]),
  }),
  z.object({
    kind: z.literal("max"),
    value: z.union([z.number(), z.string()]),
  }),
  z.object({ kind: z.literal("pattern"), value: z.string() }),
  z.object({ kind: z.literal("step"), value: z.number() }),
  z.object({ kind: z.literal("accept"), value: z.array(z.string()) }),
  z.object({ kind: z.literal("maxFileSizeBytes"), value: z.number() }),
]);

export const formFieldSchema = z.object({
  id: z.string(),
  kind: fieldKindSchema,
  label: z.string().optional(),
  required: z.boolean(),
  hasValue: z.boolean(),
  name: z.string().optional(),
  placeholder: z.string().optional(),
  autocomplete: z.string().optional(),
  description: z.string().optional(),
  nearbyText: z.array(z.string()).optional(),
  options: z.array(formOptionSchema).optional(),
  constraints: z.array(fieldConstraintSchema),
  disabled: z.boolean(),
  readOnly: z.boolean(),
});

export const formSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  method: z.enum(["get", "post"]).optional(),
  submitLabel: z.string().optional(),
  fields: z.array(formFieldSchema),
});

export const inspectFormOutputSchema = z.object({
  forms: z.array(formSchema),
});
