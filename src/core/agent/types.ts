import type { FieldId } from "../form/types";

/**
 * The agent runtime is an explicit state machine, not an autonomous loop.
 *
 * Everything here is JSON-serialisable by construction, because a run must
 * survive a service-worker restart and resume where it left off. No class
 * instances, no functions, no React state. See docs/agent.md.
 */

export type RunId = string;
export type StepIndex = number;

/** Where the run is in the OBSERVE -> ... -> DONE progression. */
export const AgentPhase = {
  OBSERVE: "observe",
  UNDERSTAND: "understand",
  RETRIEVE: "retrieve",
  PLAN: "plan",
  ACT: "act",
  VERIFY: "verify",
  DONE: "done",
} as const;

export type AgentPhase = (typeof AgentPhase)[keyof typeof AgentPhase];

/** Whether the run is progressing, and if not, why. Orthogonal to phase. */
export const AgentStatus = {
  RUNNING: "running",
  WAITING_FOR_USER: "waiting_for_user",
  PAUSED: "paused",
  RETRYING: "retrying",
  FAILED: "failed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

/**
 * The four-way answer the system gives about any piece of information.
 * "Never guess" is expressed here: there is no fifth option that means
 * "made something up".
 */
export const Certainty = {
  KNOWN: "known",
  UNKNOWN: "unknown",
  AMBIGUOUS: "ambiguous",
  REQUIRES_CONFIRMATION: "requires_confirmation",
} as const;

export type Certainty = (typeof Certainty)[keyof typeof Certainty];

/**
 * What the model may propose. Note what is absent: no "run script", no
 * "navigate", no "submit". The action vocabulary is the security boundary.
 */
export type AgentAction =
  | {
      readonly type: "call_tool";
      readonly tool: string;
      /** Unvalidated model output. Parsed against the tool schema before use. */
      readonly input: unknown;
    }
  | {
      readonly type: "ask_user";
      readonly question: string;
      readonly fieldId?: FieldId;
    }
  | { readonly type: "request_review" }
  | { readonly type: "finish"; readonly summary: string };

export interface AgentDecision {
  readonly action: AgentAction;
  /** Model-authored. May be shown to the user; never trusted as instruction. */
  readonly rationale: string;
  readonly certainty: Certainty;
}

/** Inputs that drive transitions. The runtime applies these; the model cannot. */
export type AgentEvent =
  | { readonly type: "started" }
  | { readonly type: "observed" }
  | { readonly type: "understood" }
  | { readonly type: "retrieved" }
  | { readonly type: "planned"; readonly decision: AgentDecision }
  | { readonly type: "acted"; readonly ok: boolean }
  | { readonly type: "verified"; readonly ok: boolean }
  | { readonly type: "user_input_required"; readonly question: string }
  | { readonly type: "user_responded" }
  | { readonly type: "paused" }
  | { readonly type: "resumed" }
  | { readonly type: "retry" }
  | { readonly type: "failed"; readonly errorCode: string }
  | { readonly type: "cancelled" };

export interface AgentStep {
  readonly index: StepIndex;
  readonly phase: AgentPhase;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly decision?: AgentDecision;
  /** Tool name only. Arguments and results are held outside the step log. */
  readonly toolName?: string;
  readonly ok?: boolean;
  readonly errorCode?: string;
}

export interface AgentState {
  readonly phase: AgentPhase;
  readonly status: AgentStatus;
  readonly attempt: number;
  /** Set while status is WAITING_FOR_USER. */
  readonly pendingQuestion?: string;
}

export interface AgentRun {
  readonly id: RunId;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Registrable origin the run is bound to. A run never spans origins. */
  readonly origin: string;
  readonly state: AgentState;
  readonly steps: readonly AgentStep[];
}

export const initialState: AgentState = {
  phase: AgentPhase.OBSERVE,
  status: AgentStatus.RUNNING,
  attempt: 0,
};

/**
 * The legal phase progression. Only forward moves, plus VERIFY -> PLAN for a
 * failed verification and ACT -> ACT for multi-field filling.
 */
const PHASE_TRANSITIONS: Readonly<Record<AgentPhase, readonly AgentPhase[]>> = {
  [AgentPhase.OBSERVE]: [AgentPhase.UNDERSTAND],
  [AgentPhase.UNDERSTAND]: [AgentPhase.RETRIEVE],
  [AgentPhase.RETRIEVE]: [AgentPhase.PLAN],
  [AgentPhase.PLAN]: [AgentPhase.ACT, AgentPhase.DONE],
  [AgentPhase.ACT]: [AgentPhase.VERIFY, AgentPhase.ACT],
  // A failed verification goes back to planning, never straight to acting.
  [AgentPhase.VERIFY]: [AgentPhase.PLAN, AgentPhase.OBSERVE, AgentPhase.DONE],
  [AgentPhase.DONE]: [],
};

export const canTransition = (from: AgentPhase, to: AgentPhase): boolean =>
  PHASE_TRANSITIONS[from].includes(to);

/** Statuses from which no further work happens. */
export const isTerminal = (status: AgentStatus): boolean =>
  status === AgentStatus.COMPLETED ||
  status === AgentStatus.FAILED ||
  status === AgentStatus.CANCELLED;
