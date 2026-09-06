import { describe, expect, it } from "bun:test";
import {
  deriveFreshnessHorizon,
  FreshnessStatus,
  freshness,
} from "~/core/memory/freshness";
import { bundledFreshnessDurationPolicy } from "~/core/memory/freshness-policy";
import {
  CURRENT_MEMORY_SCHEMA_VERSION,
  DEFAULT_PROFILE_ID,
  type MemoryItem,
  MemorySource,
} from "~/core/memory/types";
import { Volatility } from "~/core/ontology/types";

const BASE_TIME = "2026-01-01T00:00:00.000Z";

const item = (expiresAt?: string): MemoryItem => ({
  profileId: DEFAULT_PROFILE_ID,
  key: "contact.email",
  value: "ananya@example.com",
  schemaVersion: CURRENT_MEMORY_SCHEMA_VERSION,
  provenance: {
    source: MemorySource.USER_PROVIDED,
    confidence: 1,
    confirmedByUser: true,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    expiresAt,
  },
});

describe("freshness", () => {
  it("treats missing expiresAt as fresh", () => {
    expect(freshness(item(), "2036-01-01T00:00:00.000Z")).toBe(
      FreshnessStatus.FRESH,
    );
  });

  it("returns expiring_soon inside the 14 day window", () => {
    expect(freshness(item("2026-01-15T00:00:00.000Z"), BASE_TIME)).toBe(
      FreshnessStatus.EXPIRING_SOON,
    );
  });

  it("returns due at or after the freshness horizon", () => {
    expect(freshness(item("2026-01-01T00:00:00.000Z"), BASE_TIME)).toBe(
      FreshnessStatus.DUE,
    );
    expect(
      freshness(item("2026-01-01T00:00:00.000Z"), "2026-01-02T00:00:00.000Z"),
    ).toBe(FreshnessStatus.DUE);
  });
});

describe("deriveFreshnessHorizon", () => {
  it("covers every declared volatility class", () => {
    expect(
      deriveFreshnessHorizon(
        { key: "identity.date_of_birth", volatility: Volatility.PERMANENT },
        "1995-06-01",
        BASE_TIME,
        bundledFreshnessDurationPolicy,
      ),
    ).toEqual({ freshnessRule: "permanent" });

    expect(
      deriveFreshnessHorizon(
        { key: "identity.full_name", volatility: Volatility.STABLE },
        "Ananya Rao",
        BASE_TIME,
        bundledFreshnessDurationPolicy,
      ).expiresAt,
    ).toBe("2031-01-01T00:00:00.000Z");

    expect(
      deriveFreshnessHorizon(
        { key: "contact.postal_code", volatility: Volatility.SLOW },
        "411001",
        BASE_TIME,
        bundledFreshnessDurationPolicy,
      ).expiresAt,
    ).toBe("2027-01-01T00:00:00.000Z");

    expect(
      deriveFreshnessHorizon(
        { key: "employment.current.company", volatility: Volatility.VOLATILE },
        "Kirloskar Systems",
        BASE_TIME,
        bundledFreshnessDurationPolicy,
      ).expiresAt,
    ).toBe("2026-07-01T00:00:00.000Z");

    expect(
      deriveFreshnessHorizon(
        {
          key: "documents.passport.expiry_date",
          volatility: Volatility.SELF_DATED,
        },
        "2030-08-15",
        BASE_TIME,
        bundledFreshnessDurationPolicy,
      ).expiresAt,
    ).toBe("2030-07-16T00:00:00.000Z");
  });

  it("uses key-specific overrides before volatility defaults", () => {
    const horizon = deriveFreshnessHorizon(
      { key: "employment.current.title", volatility: Volatility.VOLATILE },
      "Engineer",
      BASE_TIME,
      bundledFreshnessDurationPolicy,
    );

    expect(horizon.expiresAt).toBe("2026-04-01T00:00:00.000Z");
    expect(horizon.freshnessRule).toBe("override:employment.current.title:P3M");
  });

  it("falls back to the most conservative configured duration for unknown volatility", () => {
    const horizon = deriveFreshnessHorizon(
      { key: "future.unknown", volatility: "future_class" as Volatility },
      "value",
      BASE_TIME,
      bundledFreshnessDurationPolicy,
    );

    expect(horizon.expiresAt).toBe("2026-07-01T00:00:00.000Z");
    expect(horizon.freshnessRule).toBe("future_class:P6M");
  });
});
