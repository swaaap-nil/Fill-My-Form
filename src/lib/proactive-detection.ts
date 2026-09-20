import type { FieldProposal } from "~/core/fill/types";

export interface ActionableProposalCounts {
  readonly knownFieldCount: number;
  readonly answerCount: number;
}

const isActionableProposal = (
  proposal: FieldProposal,
): proposal is FieldProposal & {
  state: "pending" | "restricted" | "choose_option";
} =>
  proposal.state === "pending" ||
  proposal.state === "restricted" ||
  proposal.state === "choose_option";

export const countActionableProposals = (
  proposals: readonly FieldProposal[],
): ActionableProposalCounts => {
  let knownFieldCount = 0;
  let answerCount = 0;

  for (const proposal of proposals) {
    if (!isActionableProposal(proposal)) continue;
    knownFieldCount += 1;
    if (proposal.state === "choose_option") {
      answerCount += proposal.choices.length;
    } else {
      answerCount += 1;
    }
  }

  return { knownFieldCount, answerCount };
};

export interface DetectionDedupeState {
  readonly url: string;
  readonly knownFieldCount: number;
  readonly answerCount: number;
  readonly notifiedAtMs: number;
}

export const DETECTION_DEDUPE_TTL_MS = 20 * 60 * 1000;

export const shouldNotifyForDetection = (
  previous: DetectionDedupeState | undefined,
  next: ActionableProposalCounts & { url: string },
  nowMs: number,
): boolean => {
  if (next.knownFieldCount <= 0) return false;
  if (!previous) return true;
  if (previous.url !== next.url) return true;
  if (
    next.knownFieldCount > previous.knownFieldCount ||
    next.answerCount > previous.answerCount
  ) {
    return true;
  }
  return nowMs - previous.notifiedAtMs >= DETECTION_DEDUPE_TTL_MS;
};
