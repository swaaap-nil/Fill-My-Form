import { describe, expect, it } from "bun:test";
import type { FieldProposal } from "~/core/fill/types";
import { MemorySource } from "~/core/memory/types";
import {
  countActionableProposals,
  shouldNotifyForDetection,
} from "~/lib/proactive-detection";

describe("countActionableProposals", () => {
  it("counts pending and choose_option answers separately", () => {
    const proposals: FieldProposal[] = [
      {
        fieldId: "f1",
        state: "pending",
        conceptKey: "person.name",
        decisionId: "d1",
        value: "A",
        payload: { kind: "text", value: "A" },
        source: MemorySource.USER_PROVIDED,
        policyReason: "ok",
      },
      {
        fieldId: "f2",
        state: "unknown",
      },
      {
        fieldId: "f3",
        state: "choose_option",
        conceptKey: "person.country",
        storedValue: "IN",
        choices: [
          { decisionId: "d2", label: "India" },
          { decisionId: "d3", label: "IN" },
        ],
      },
    ];

    expect(countActionableProposals(proposals)).toEqual({
      knownFieldCount: 2,
      answerCount: 3,
    });
  });
});

describe("shouldNotifyForDetection", () => {
  it("suppresses repeat notifications within TTL for the same counts", () => {
    const now = 1_000_000;
    const previous = {
      url: "https://example.com/a",
      knownFieldCount: 2,
      answerCount: 2,
      notifiedAtMs: now - 1000,
    };
    expect(
      shouldNotifyForDetection(
        previous,
        { url: "https://example.com/a", knownFieldCount: 2, answerCount: 2 },
        now,
      ),
    ).toBe(false);
  });

  it("notifies again when counts increase", () => {
    expect(
      shouldNotifyForDetection(
        {
          url: "https://example.com/a",
          knownFieldCount: 1,
          answerCount: 1,
          notifiedAtMs: 0,
        },
        { url: "https://example.com/a", knownFieldCount: 2, answerCount: 2 },
        1000,
      ),
    ).toBe(true);
  });
});
