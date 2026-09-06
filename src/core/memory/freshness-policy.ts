import { z } from "zod";
import { Volatility } from "../ontology/types";

export const FRESHNESS_POLICY_SCHEMA_VERSION = 1;

export const freshnessDurationPolicySchema = z.object({
  version: z.literal(FRESHNESS_POLICY_SCHEMA_VERSION),
  ttl: z.object({
    [Volatility.STABLE]: z.string().regex(/^P\d+[YMD]$/),
    [Volatility.SLOW]: z.string().regex(/^P\d+[YMD]$/),
    [Volatility.VOLATILE]: z.string().regex(/^P\d+[YMD]$/),
  }),
  leadTime: z.object({
    [Volatility.SELF_DATED]: z.string().regex(/^P\d+[YMD]$/),
  }),
  overrides: z.record(z.string(), z.string().regex(/^P\d+[YMD]$/)),
});

export type FreshnessDurationPolicy = z.infer<
  typeof freshnessDurationPolicySchema
>;

export const bundledFreshnessDurationPolicy =
  freshnessDurationPolicySchema.parse({
    version: FRESHNESS_POLICY_SCHEMA_VERSION,
    ttl: {
      [Volatility.STABLE]: "P5Y",
      [Volatility.SLOW]: "P1Y",
      [Volatility.VOLATILE]: "P6M",
    },
    leadTime: {
      [Volatility.SELF_DATED]: "P30D",
    },
    overrides: {
      "employment.current.title": "P3M",
    },
  });
