import {
  type AgentEvent,
  AgentPhase,
  type AgentState,
  AgentStatus,
  canTransition,
  initialState,
  isTerminal,
} from "./types";

/**
 * The pure half of the state machine: `(AgentState, AgentEvent) -> AgentState`.
 *
 * No IO, no clock, no randomness — `~/core/agent/loop` is the only caller,
 * and it is responsible for deciding *when* to raise which event (running a
 * tool, reading memory, asking the user). This file only has one job: never
 * produce a phase pair `canTransition` forbids, and never let a terminal
 * status un-terminate.
 *
 * Two rules make every branch below safe under an arbitrary event sequence,
 * which is what `agent-reducer.test.ts`'s property test throws at it:
 *
 * 1. **Terminal statuses are absorbing.** Checked once, at the top: once
 *    `status` is `completed`, `failed` or `cancelled`, no event changes
 *    anything.
 * 2. **A phase-moving event only fires from its exact source phase.** An
 *    event that doesn't apply to the current phase is a no-op, not a forced
 *    jump. `canTransition` is only consulted when the phase value would
 *    actually change — staying put can never violate an edge list, only an
 *    actual move can, so an identity "transition" (e.g. re-entering ACT)
 *    needs no check.
 */

const moveTo = (
  from: AgentPhase,
  to: AgentPhase,
  state: AgentState,
  next: Omit<AgentState, "phase">,
): AgentState => {
  if (state.phase !== from) return state;
  if (from !== to && !canTransition(from, to)) return state;
  return { ...next, phase: to };
};

export const reduce = (state: AgentState, event: AgentEvent): AgentState => {
  if (isTerminal(state.status)) return state;

  switch (event.type) {
    case "started":
      // Only meaningful as the very first event; a stray one mid-run is a
      // no-op rather than a forced reset, which would jump the phase from
      // wherever it is straight to OBSERVE with no legal edge to justify it.
      return state.phase === AgentPhase.OBSERVE ? { ...initialState } : state;

    case "observed":
      return moveTo(AgentPhase.OBSERVE, AgentPhase.UNDERSTAND, state, {
        status: AgentStatus.RUNNING,
        attempt: 0,
      });

    case "understood":
      return moveTo(AgentPhase.UNDERSTAND, AgentPhase.RETRIEVE, state, {
        status: AgentStatus.RUNNING,
        attempt: 0,
      });

    case "retrieved":
      return moveTo(AgentPhase.RETRIEVE, AgentPhase.PLAN, state, {
        status: AgentStatus.RUNNING,
        attempt: 0,
      });

    case "planned": {
      if (state.phase !== AgentPhase.PLAN) return state;
      const target =
        event.decision.action.type === "finish"
          ? AgentPhase.DONE
          : AgentPhase.ACT;
      return moveTo(AgentPhase.PLAN, target, state, {
        status:
          target === AgentPhase.DONE
            ? AgentStatus.COMPLETED
            : AgentStatus.RUNNING,
        attempt: 0,
      });
    }

    case "acted": {
      if (state.phase !== AgentPhase.ACT) return state;
      if (event.ok) {
        return moveTo(AgentPhase.ACT, AgentPhase.VERIFY, state, {
          status: AgentStatus.RUNNING,
          attempt: 0,
        });
      }
      // A tool-execution failure, not a failed verification: retried within
      // ACT (the table has no ACT -> PLAN edge on purpose). The loop decides
      // how many times `attempt` may climb before it gives up and raises
      // `failed` instead of `retry`.
      return moveTo(AgentPhase.ACT, AgentPhase.ACT, state, {
        status: AgentStatus.RETRYING,
        attempt: state.attempt + 1,
      });
    }

    case "verified": {
      if (state.phase !== AgentPhase.VERIFY) return state;
      // Both outcomes go back to PLAN, never straight to ACT — a retry (or
      // the next field, or a FORM_CHANGED re-plan) must be re-decided. Only
      // `attempt` distinguishes them, so the loop's next PLAN step can tell
      // "fresh field" from "this one just failed verification again".
      return moveTo(AgentPhase.VERIFY, AgentPhase.PLAN, state, {
        status: AgentStatus.RUNNING,
        attempt: event.ok ? 0 : state.attempt + 1,
      });
    }

    case "user_input_required":
      // Only meaningful while acting on an ask_user/request_review decision.
      // ACT -> ACT: the phase does not move, so no edge check applies.
      if (state.phase !== AgentPhase.ACT) return state;
      return {
        phase: AgentPhase.ACT,
        status: AgentStatus.WAITING_FOR_USER,
        attempt: state.attempt,
        pendingQuestion: event.question,
      };

    case "user_responded":
      if (state.status !== AgentStatus.WAITING_FOR_USER) return state;
      return {
        ...state,
        status: AgentStatus.RUNNING,
        pendingQuestion: undefined,
      };

    case "paused":
      return { ...state, status: AgentStatus.PAUSED };

    case "resumed":
      return state.status === AgentStatus.PAUSED
        ? { ...state, status: AgentStatus.RUNNING }
        : state;

    case "retry":
      // Explicit "try the same act again" signal, following an
      // `acted:{ok:false}` retry. Phase stays ACT; only status moves.
      return state.status === AgentStatus.RETRYING
        ? { ...state, status: AgentStatus.RUNNING }
        : state;

    case "failed":
      return {
        ...state,
        status: AgentStatus.FAILED,
        pendingQuestion: undefined,
      };

    case "cancelled":
      return {
        ...state,
        status: AgentStatus.CANCELLED,
        pendingQuestion: undefined,
      };

    default:
      return state;
  }
};
