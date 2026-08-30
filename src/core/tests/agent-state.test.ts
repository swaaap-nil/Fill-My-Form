import { describe, expect, it } from "bun:test";
import {
  AgentPhase,
  AgentStatus,
  canTransition,
  initialState,
  isTerminal,
} from "~/core/agent/types";

describe("phase transitions", () => {
  it("walks the happy path", () => {
    expect(canTransition(AgentPhase.OBSERVE, AgentPhase.UNDERSTAND)).toBe(true);
    expect(canTransition(AgentPhase.UNDERSTAND, AgentPhase.RETRIEVE)).toBe(
      true,
    );
    expect(canTransition(AgentPhase.RETRIEVE, AgentPhase.PLAN)).toBe(true);
    expect(canTransition(AgentPhase.PLAN, AgentPhase.ACT)).toBe(true);
    expect(canTransition(AgentPhase.ACT, AgentPhase.VERIFY)).toBe(true);
    expect(canTransition(AgentPhase.VERIFY, AgentPhase.DONE)).toBe(true);
  });

  it("sends a failed verification back to PLAN, not to ACT", () => {
    expect(canTransition(AgentPhase.VERIFY, AgentPhase.PLAN)).toBe(true);
    expect(canTransition(AgentPhase.VERIFY, AgentPhase.ACT)).toBe(false);
  });

  it("rejects skipping straight from OBSERVE to ACT", () => {
    expect(canTransition(AgentPhase.OBSERVE, AgentPhase.ACT)).toBe(false);
  });

  it("treats DONE as an absorbing state", () => {
    expect(canTransition(AgentPhase.DONE, AgentPhase.PLAN)).toBe(false);
  });
});

describe("run state", () => {
  it("starts at OBSERVE and running", () => {
    expect(initialState.phase).toBe(AgentPhase.OBSERVE);
    expect(initialState.status).toBe(AgentStatus.RUNNING);
    expect(isTerminal(initialState.status)).toBe(false);
  });

  it("treats waiting_for_user as non-terminal so the run can resume", () => {
    expect(isTerminal(AgentStatus.WAITING_FOR_USER)).toBe(false);
    expect(isTerminal(AgentStatus.PAUSED)).toBe(false);
    expect(isTerminal(AgentStatus.COMPLETED)).toBe(true);
    expect(isTerminal(AgentStatus.CANCELLED)).toBe(true);
  });

  it("keeps run state JSON-serialisable, so a run survives a worker restart", () => {
    const round = JSON.parse(JSON.stringify(initialState));
    expect(round).toEqual(initialState);
  });
});
