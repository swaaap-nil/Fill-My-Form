import { describe, expect, it } from "bun:test";
import { reduce } from "~/core/agent/reducer";
import {
  type AgentDecision,
  type AgentEvent,
  AgentPhase,
  type AgentState,
  AgentStatus,
  Certainty,
  canTransition,
  initialState,
  isTerminal,
} from "~/core/agent/types";

const finishDecision: AgentDecision = {
  action: { type: "finish", summary: "done" },
  rationale: "nothing left to do",
  certainty: Certainty.KNOWN,
};

const fillDecision: AgentDecision = {
  action: { type: "call_tool", tool: "fill_field", input: {} },
  rationale: "known value, policy allows",
  certainty: Certainty.KNOWN,
};

describe("reduce: the happy path", () => {
  it("walks OBSERVE through DONE on a single known, allowed field", () => {
    let state = initialState;
    state = reduce(state, { type: "observed" });
    expect(state.phase).toBe(AgentPhase.UNDERSTAND);
    state = reduce(state, { type: "understood" });
    expect(state.phase).toBe(AgentPhase.RETRIEVE);
    state = reduce(state, { type: "retrieved" });
    expect(state.phase).toBe(AgentPhase.PLAN);
    state = reduce(state, { type: "planned", decision: fillDecision });
    expect(state.phase).toBe(AgentPhase.ACT);
    state = reduce(state, { type: "acted", ok: true });
    expect(state.phase).toBe(AgentPhase.VERIFY);
    state = reduce(state, { type: "verified", ok: true });
    expect(state.phase).toBe(AgentPhase.PLAN);
    state = reduce(state, { type: "planned", decision: finishDecision });
    expect(state.phase).toBe(AgentPhase.DONE);
    expect(state.status).toBe(AgentStatus.COMPLETED);
  });
});

describe("reduce: failed verification", () => {
  it("sends a failed verification back to PLAN, not to ACT", () => {
    const acting: AgentState = {
      phase: AgentPhase.ACT,
      status: AgentStatus.RUNNING,
      attempt: 0,
    };
    const verifying = reduce(acting, { type: "acted", ok: true });
    expect(verifying.phase).toBe(AgentPhase.VERIFY);

    const replanned = reduce(verifying, { type: "verified", ok: false });
    expect(replanned.phase).toBe(AgentPhase.PLAN);
    expect(replanned.attempt).toBe(1);
  });

  it("resets attempt to 0 once a field verifies successfully", () => {
    const verifying: AgentState = {
      phase: AgentPhase.VERIFY,
      status: AgentStatus.RUNNING,
      attempt: 3,
    };
    const replanned = reduce(verifying, { type: "verified", ok: true });
    expect(replanned.attempt).toBe(0);
  });
});

describe("reduce: tool-execution retry stays in ACT", () => {
  it("retries within ACT on a failed tool call, incrementing attempt", () => {
    const acting: AgentState = {
      phase: AgentPhase.ACT,
      status: AgentStatus.RUNNING,
      attempt: 0,
    };
    const retried = reduce(acting, { type: "acted", ok: false });
    expect(retried.phase).toBe(AgentPhase.ACT);
    expect(retried.status).toBe(AgentStatus.RETRYING);
    expect(retried.attempt).toBe(1);
  });

  it("moves from RETRYING back to RUNNING on an explicit retry event", () => {
    const retrying: AgentState = {
      phase: AgentPhase.ACT,
      status: AgentStatus.RETRYING,
      attempt: 1,
    };
    const retried = reduce(retrying, { type: "retry" });
    expect(retried.status).toBe(AgentStatus.RUNNING);
    expect(retried.phase).toBe(AgentPhase.ACT);
  });
});

describe("reduce: the ask_user / request_review round trip", () => {
  it("pauses in ACT with WAITING_FOR_USER, without changing phase", () => {
    const acting: AgentState = {
      phase: AgentPhase.ACT,
      status: AgentStatus.RUNNING,
      attempt: 0,
    };
    const waiting = reduce(acting, {
      type: "user_input_required",
      question: "What is your email address?",
    });
    expect(waiting.phase).toBe(AgentPhase.ACT);
    expect(waiting.status).toBe(AgentStatus.WAITING_FOR_USER);
    expect(waiting.pendingQuestion).toBe("What is your email address?");
  });

  it("resumes to RUNNING and clears the pending question on an answer", () => {
    const waiting: AgentState = {
      phase: AgentPhase.ACT,
      status: AgentStatus.WAITING_FOR_USER,
      attempt: 0,
      pendingQuestion: "What is your email address?",
    };
    const resumed = reduce(waiting, { type: "user_responded" });
    expect(resumed.status).toBe(AgentStatus.RUNNING);
    expect(resumed.pendingQuestion).toBeUndefined();
    // Still ACT: the loop now performs the actual write (ACT -> ACT), or
    // moves on to VERIFY once it does.
    expect(resumed.phase).toBe(AgentPhase.ACT);
  });

  it("ignores user_input_required outside ACT", () => {
    const planning: AgentState = {
      phase: AgentPhase.PLAN,
      status: AgentStatus.RUNNING,
      attempt: 0,
    };
    const unchanged = reduce(planning, {
      type: "user_input_required",
      question: "irrelevant here",
    });
    expect(unchanged).toEqual(planning);
  });
});

describe("reduce: illegal jumps are no-ops, not forced moves", () => {
  it("ignores an out-of-order event rather than skipping straight to ACT", () => {
    const observing: AgentState = {
      phase: AgentPhase.OBSERVE,
      status: AgentStatus.RUNNING,
      attempt: 0,
    };
    const unchanged = reduce(observing, { type: "acted", ok: true });
    expect(unchanged).toEqual(observing);
  });

  it("treats a stray 'started' mid-run as a no-op rather than a reset", () => {
    const acting: AgentState = {
      phase: AgentPhase.ACT,
      status: AgentStatus.RUNNING,
      attempt: 2,
    };
    const unchanged = reduce(acting, { type: "started" });
    expect(unchanged).toEqual(acting);
  });
});

describe("reduce: terminal statuses are absorbing", () => {
  const terminalStates: AgentState[] = [
    { phase: AgentPhase.DONE, status: AgentStatus.COMPLETED, attempt: 0 },
    { phase: AgentPhase.ACT, status: AgentStatus.FAILED, attempt: 3 },
    { phase: AgentPhase.PLAN, status: AgentStatus.CANCELLED, attempt: 0 },
  ];

  const events: AgentEvent[] = [
    { type: "started" },
    { type: "observed" },
    { type: "resumed" },
    { type: "retry" },
    { type: "user_responded" },
    { type: "planned", decision: fillDecision },
  ];

  for (const state of terminalStates) {
    for (const event of events) {
      it(`never leaves ${state.status} on '${event.type}'`, () => {
        expect(reduce(state, event)).toEqual(state);
      });
    }
  }
});

// --- Property test ----------------------------------------------------------

/**
 * A small, hand-rolled seeded PRNG rather than adding a property-testing
 * dependency. There's no such dependency in the repo already, and
 * ADR 004's whole point is that this state machine's control flow is small
 * enough to own outright rather than reaching for a library.
 */
const mulberry32 = (seed: number) => {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = <T>(rng: () => number, options: readonly T[]): T => {
  const value = options[Math.floor(rng() * options.length)];
  if (value === undefined) throw new Error("pick() called with no options");
  return value;
};

const randomEvent = (rng: () => number): AgentEvent => {
  const kind = pick(rng, [
    "started",
    "observed",
    "understood",
    "retrieved",
    "planned_fill",
    "planned_finish",
    "acted_ok",
    "acted_fail",
    "verified_ok",
    "verified_fail",
    "user_input_required",
    "user_responded",
    "paused",
    "resumed",
    "retry",
    "failed",
    "cancelled",
  ] as const);

  switch (kind) {
    case "planned_fill":
      return { type: "planned", decision: fillDecision };
    case "planned_finish":
      return { type: "planned", decision: finishDecision };
    case "acted_ok":
      return { type: "acted", ok: true };
    case "acted_fail":
      return { type: "acted", ok: false };
    case "verified_ok":
      return { type: "verified", ok: true };
    case "verified_fail":
      return { type: "verified", ok: false };
    case "user_input_required":
      return { type: "user_input_required", question: "q" };
    case "failed":
      return { type: "failed", errorCode: "SOME_ERROR" };
    default:
      return { type: kind };
  }
};

describe("reduce: property — no random event sequence breaks the invariants", () => {
  const SEQUENCES = 500;
  const EVENTS_PER_SEQUENCE = 40;

  it(`holds over ${SEQUENCES} random sequences of ${EVENTS_PER_SEQUENCE} events each`, () => {
    for (let seed = 0; seed < SEQUENCES; seed++) {
      const rng = mulberry32(seed);
      let state: AgentState = initialState;

      for (let step = 0; step < EVENTS_PER_SEQUENCE; step++) {
        const event = randomEvent(rng);
        const next = reduce(state, event);

        if (next.phase !== state.phase) {
          expect(canTransition(state.phase, next.phase)).toBe(true);
        }

        if (isTerminal(state.status)) {
          expect(next).toEqual(state);
        }

        state = next;
      }
    }
  });
});
