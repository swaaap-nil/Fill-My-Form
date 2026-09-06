import type { Concept } from "../ontology/types";
import { Volatility } from "../ontology/types";
import type { FreshnessDurationPolicy } from "./freshness-policy";
import type { MemoryItem, MemoryValue } from "./types";

export const FreshnessStatus = {
  FRESH: "fresh",
  EXPIRING_SOON: "expiring_soon",
  DUE: "due",
} as const;

export type FreshnessStatus =
  (typeof FreshnessStatus)[keyof typeof FreshnessStatus];

const EXPIRING_SOON_MS = 14 * 24 * 60 * 60 * 1000;

interface DurationParts {
  readonly amount: number;
  readonly unit: "Y" | "M" | "D";
}

const parseDuration = (duration: string): DurationParts => {
  const match = /^P(\d+)([YMD])$/.exec(duration);
  if (!match) throw new Error(`Unsupported freshness duration: ${duration}`);
  return { amount: Number(match[1]), unit: match[2] as DurationParts["unit"] };
};

const addDuration = (iso: string, duration: string): string => {
  const parts = parseDuration(duration);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid freshness base date: ${iso}`);
  }

  if (parts.unit === "Y") {
    date.setUTCFullYear(date.getUTCFullYear() + parts.amount);
  } else if (parts.unit === "M") {
    date.setUTCMonth(date.getUTCMonth() + parts.amount);
  } else {
    date.setUTCDate(date.getUTCDate() + parts.amount);
  }

  return date.toISOString();
};

const subtractDuration = (iso: string, duration: string): string => {
  const parts = parseDuration(duration);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return addDuration(iso, duration);

  if (parts.unit === "Y") {
    date.setUTCFullYear(date.getUTCFullYear() - parts.amount);
  } else if (parts.unit === "M") {
    date.setUTCMonth(date.getUTCMonth() - parts.amount);
  } else {
    date.setUTCDate(date.getUTCDate() - parts.amount);
  }

  return date.toISOString();
};

const approximateMs = (duration: string): number => {
  const parts = parseDuration(duration);
  if (parts.unit === "Y") return parts.amount * 365 * 24 * 60 * 60 * 1000;
  if (parts.unit === "M") return parts.amount * 30 * 24 * 60 * 60 * 1000;
  return parts.amount * 24 * 60 * 60 * 1000;
};

const mostConservativeTtl = (policy: FreshnessDurationPolicy): string =>
  Object.values(policy.ttl).reduce((shortest, candidate) =>
    approximateMs(candidate) < approximateMs(shortest) ? candidate : shortest,
  );

const valueAsDate = (value: MemoryValue): string | null => {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

export interface FreshnessHorizon {
  readonly expiresAt?: string;
  readonly freshnessRule: string;
}

export const deriveFreshnessHorizon = (
  concept: Pick<Concept, "key" | "volatility">,
  value: MemoryValue,
  baseTime: string,
  policy: FreshnessDurationPolicy,
): FreshnessHorizon => {
  if (concept.volatility === Volatility.PERMANENT) {
    return { freshnessRule: Volatility.PERMANENT };
  }

  if (concept.volatility === Volatility.SELF_DATED) {
    const datedValue = valueAsDate(value);
    if (datedValue) {
      return {
        expiresAt: subtractDuration(
          datedValue,
          policy.leadTime[Volatility.SELF_DATED],
        ),
        freshnessRule: `${Volatility.SELF_DATED}:${policy.leadTime[Volatility.SELF_DATED]}`,
      };
    }
  }

  const override = policy.overrides[concept.key];
  const ttl =
    override ??
    policy.ttl[concept.volatility as keyof FreshnessDurationPolicy["ttl"]] ??
    mostConservativeTtl(policy);

  return {
    expiresAt: addDuration(baseTime, ttl),
    freshnessRule: override
      ? `override:${concept.key}:${ttl}`
      : `${concept.volatility}:${ttl}`,
  };
};

export const refreshMemoryItemHorizon = (
  item: MemoryItem,
  concept: Pick<Concept, "key" | "volatility"> | undefined,
  now: string,
  policy: FreshnessDurationPolicy,
): MemoryItem => {
  if (!concept) return item;
  const horizon = deriveFreshnessHorizon(concept, item.value, now, policy);
  return {
    ...item,
    provenance: {
      ...item.provenance,
      expiresAt: horizon.expiresAt,
      freshnessRule: horizon.freshnessRule,
    },
  };
};

export const freshness = (
  item: Pick<MemoryItem, "provenance">,
  now: string,
): FreshnessStatus => {
  const expiresAt = item.provenance.expiresAt;
  if (!expiresAt) return FreshnessStatus.FRESH;

  const expiry = Date.parse(expiresAt);
  const current = Date.parse(now);
  if (Number.isNaN(expiry) || Number.isNaN(current)) {
    return FreshnessStatus.DUE;
  }

  if (current >= expiry) return FreshnessStatus.DUE;
  if (expiry - current <= EXPIRING_SOON_MS) {
    return FreshnessStatus.EXPIRING_SOON;
  }
  return FreshnessStatus.FRESH;
};
