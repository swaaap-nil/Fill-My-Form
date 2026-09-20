import { describe, expect, it } from "bun:test";
import { createInMemoryMemoryStore } from "~/core/memory/in-memory";
import { DEFAULT_PROFILE_ID, MemorySource } from "~/core/memory/types";
import { recordAnswer } from "~/core/memory/write-service";

describe("recordAnswer: the user-answer path to stored memory", () => {
  it("writes a user-provided answer as confirmed, at full confidence by default", async () => {
    const store = createInMemoryMemoryStore();

    await recordAnswer(store, {
      profileId: DEFAULT_PROFILE_ID,
      key: "contact.email",
      value: "ananya@example.com",
      label: "Email address",
      source: MemorySource.USER_PROVIDED,
      now: "2026-01-01T00:00:00.000Z",
    });

    const item = await store.get(DEFAULT_PROFILE_ID, "contact.email");
    expect(item?.value).toBe("ananya@example.com");
    expect(item?.provenance.source).toBe(MemorySource.USER_PROVIDED);
    expect(item?.provenance.confidence).toBe(1);
    expect(item?.provenance.confirmedByUser).toBe(true);
    expect(item?.provenance.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("preserves the original createdAt across a later confirmed re-write", async () => {
    const store = createInMemoryMemoryStore();

    await recordAnswer(store, {
      profileId: DEFAULT_PROFILE_ID,
      key: "contact.email",
      value: "ananya@example.com",
      source: MemorySource.USER_PROVIDED,
      now: "2026-01-01T00:00:00.000Z",
    });

    await recordAnswer(store, {
      profileId: DEFAULT_PROFILE_ID,
      key: "contact.email",
      value: "ananya@example.com",
      source: MemorySource.USER_CONFIRMED,
      confidence: 0.7,
      now: "2026-03-01T00:00:00.000Z",
    });

    const item = await store.get(DEFAULT_PROFILE_ID, "contact.email");
    expect(item?.provenance.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(item?.provenance.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(item?.provenance.source).toBe(MemorySource.USER_CONFIRMED);
    expect(item?.provenance.confidence).toBe(0.7);
  });

  it("carries evidence and freshness fields through untouched", async () => {
    const store = createInMemoryMemoryStore();

    await recordAnswer(store, {
      profileId: DEFAULT_PROFILE_ID,
      key: "identity.date_of_birth",
      value: "1995-06-01",
      source: MemorySource.USER_PROVIDED,
      now: "2026-01-01T00:00:00.000Z",
      evidence: "onboarding-form",
      freshnessRule: "permanent",
    });

    const item = await store.get(DEFAULT_PROFILE_ID, "identity.date_of_birth");
    expect(item?.provenance.evidence).toBe("onboarding-form");
    expect(item?.provenance.freshnessRule).toBe("permanent");
  });
});
