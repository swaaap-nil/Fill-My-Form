import { describe, expect, it } from "bun:test";
import {
  ALL_SITES_UPGRADE_FULL_STRIP_MAX_IMPRESSIONS,
  type AllSitesUpgradeState,
  isAllSitesUpgradeSnoozed,
  recordUpgradeImpression,
  shouldShowAllSitesUpgradeLink,
  shouldShowAllSitesUpgradeStrip,
} from "~/lib/all-sites-upgrade-prompt";

const baseState = (): AllSitesUpgradeState => ({
  snoozedUntilIso: null,
  impressionCount: 0,
});

describe("shouldShowAllSitesUpgradeStrip", () => {
  it("hides when all-site access is already granted", () => {
    expect(
      shouldShowAllSitesUpgradeStrip(
        baseState(),
        "2026-01-01T00:00:00.000Z",
        true,
        true,
      ),
    ).toBe(false);
  });

  it("hides before a successful scan", () => {
    expect(
      shouldShowAllSitesUpgradeStrip(
        baseState(),
        "2026-01-01T00:00:00.000Z",
        false,
        false,
      ),
    ).toBe(false);
  });

  it("shows after success when not snoozed and under impression cap", () => {
    expect(
      shouldShowAllSitesUpgradeStrip(
        baseState(),
        "2026-01-01T00:00:00.000Z",
        false,
        true,
      ),
    ).toBe(true);
  });

  it("hides while snoozed", () => {
    expect(
      shouldShowAllSitesUpgradeStrip(
        {
          snoozedUntilIso: "2026-02-01T00:00:00.000Z",
          impressionCount: 0,
        },
        "2026-01-01T00:00:00.000Z",
        false,
        true,
      ),
    ).toBe(false);
  });

  it("hides full strip after impression cap", () => {
    expect(
      shouldShowAllSitesUpgradeStrip(
        {
          snoozedUntilIso: null,
          impressionCount: ALL_SITES_UPGRADE_FULL_STRIP_MAX_IMPRESSIONS,
        },
        "2026-01-01T00:00:00.000Z",
        false,
        true,
      ),
    ).toBe(false);
  });
});

describe("shouldShowAllSitesUpgradeLink", () => {
  it("shows compact link only after impression cap", () => {
    expect(
      shouldShowAllSitesUpgradeLink(
        {
          snoozedUntilIso: null,
          impressionCount: ALL_SITES_UPGRADE_FULL_STRIP_MAX_IMPRESSIONS,
        },
        "2026-01-01T00:00:00.000Z",
        false,
        true,
      ),
    ).toBe(true);
  });
});

describe("isAllSitesUpgradeSnoozed", () => {
  it("treats expired snooze as inactive", () => {
    expect(
      isAllSitesUpgradeSnoozed(
        { snoozedUntilIso: "2026-01-01T00:00:00.000Z", impressionCount: 1 },
        "2026-02-01T00:00:00.000Z",
      ),
    ).toBe(false);
  });
});

describe("recordUpgradeImpression", () => {
  it("increments the impression count", () => {
    expect(recordUpgradeImpression(baseState()).impressionCount).toBe(1);
  });
});
