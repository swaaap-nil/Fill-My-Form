/**
 * The loop: drives `AgentState` through `reduce`, with every side effect —
 * the tool registry, the policy engine, the memory store, the ontology, the
 * verifier, the clock, id generation — injected as `LoopPorts`. Nothing here
 * imports `wxt/browser` or touches a DOM; the composition root
 * (`src/app/background`) wires real adapters in, and `agent-loop.test.ts`
 * wires fakes in.
 *
 * No model exists yet (Phase 3), so every `PLAN` decision below is
 * deterministic: it is 1c's `resolve() -> memory -> policy.evaluate()`
 * pipeline (`~/core/fill/driver`), restructured to decide one field at a
 * time and expressed as an `AgentAction` instead of a flat proposal.
 *
 * ## Why a `step`/`drive` pair, not one long-running async function
 *
 * A run must survive the service worker being killed mid-`ask_user`. An
 * `await` on a promise that resolves only when the panel answers cannot
 * survive that — the call stack (and the promise) dies with the worker. So
 * the loop is not a coroutine: `step` performs exactly one phase's work and
 * returns a new, fully JSON-serialisable {@link RunSnapshot}. The
 * composition root persists that snapshot after every step (`chrome.storage
 * .session`) and calls `drive` again — from a *fresh* `RunSnapshot* read
 * back off storage after a real restart, or from the same one in memory
 * otherwise. Either way `step`/`drive` cannot tell the difference, which is
 * the property that makes resumability fall out of the design rather than
 * being bolted on.
 *
 * `AgentRun` (from `./types`) is exactly the round-trip-tested type; nothing
 * here changes its shape. The extra bookkeeping a resumed run actually needs
 * — which tab, which fields, which field is mid-cycle — lives in the
 * sibling fields of {@link RunSnapshot}, since `AgentRun` itself has no
 * concept of "current field" and isn't the place to add one.
 */

import type { FileComplianceAdapter } from "../files/types";
import {
  resolveMemoryItemForConcept,
  resolveStoredValueForField,
} from "../fill/driver";
import type { FillPayload } from "../fill/types";
import type { FieldConstraint, FieldId, Form, FormField } from "../form/types";
import type { LLMProvider } from "../llm/provider";
import type { Logger } from "../logging";
import { tierToConfidence } from "../matching/confidence";
import { mapFieldWithModel } from "../matching/model-tier";
import { resolve } from "../matching/resolve";
import type { MatchResult } from "../matching/types";
import {
  deriveFreshnessHorizon,
  FreshnessStatus,
  freshness,
} from "../memory/freshness";
import { bundledFreshnessDurationPolicy } from "../memory/freshness-policy";
import type { MemoryStore } from "../memory/store";
import {
  type FileReference,
  isFileReference,
  MemorySource,
  type MemoryValue,
  type ProfileId,
} from "../memory/types";
import { recordAnswer } from "../memory/write-service";
import type { ConceptIndex, Sensitivity } from "../ontology/types";
import {
  ActionRisk,
  ConfidenceLevel,
  PolicyEffect,
  type PolicyEngine,
} from "../policy/types";
import { executeTool } from "../tools/registry";
import type { ToolContext, ToolRegistry } from "../tools/types";
import type { Verifier } from "../verification/types";
import { reduce } from "./reducer";
import {
  type AgentDecision,
  type AgentEvent,
  AgentPhase,
  type AgentRun,
  AgentStatus,
  type AgentStep,
  Certainty,
  initialState,
  isTerminal,
} from "./types";

/** Tool names the composition root must register for the loop to function. */
export const INSPECT_FORM_TOOL = "inspect_form";
export const FILL_FIELD_TOOL = "fill_field";
export const UPLOAD_FILE_TOOL = "upload_file";

/** A field's resolved value, carried alongside the run so PLAN never re-asks. */
export interface RetrievedValue {
  readonly value: MemoryValue;
  readonly payload: FillPayload;
  readonly displayValue: string;
  readonly conceptKey: string;
  readonly sensitivity: Sensitivity;
  readonly confidence: ConfidenceLevel;
  readonly memoryWrite?:
    | false
    | { readonly key: string; readonly value: MemoryValue };
  readonly confirmedInRun?: boolean;
  readonly stale?: boolean;
}

/**
 * Everything a fresh loop instance needs to continue a run — `AgentRun`
 * itself, plus the bookkeeping `AgentRun`'s type doesn't carry. Persisted as
 * one JSON blob per run (see decision #5 in the phase 2 plan).
 */
export interface RunSnapshot {
  readonly run: AgentRun;
  readonly tabId: number;
  readonly fields: readonly FormField[];
  /** Primary language subtag of the observed page, from `Form.documentLocale`. */
  readonly documentLocale?: string;
  readonly matches: Readonly<Record<FieldId, MatchResult>>;
  readonly values: Readonly<Record<FieldId, RetrievedValue | undefined>>;
  /** Fields that will never get another PLAN turn: filled, skipped, or given up on. */
  readonly handled: readonly FieldId[];
  /** The field PLAN most recently decided about, if any. */
  readonly cursor: FieldId | null;
  /**
   * How many verification failures `cursor` has accumulated, across
   * PLAN -> ACT -> VERIFY cycles. Tracked here rather than read off
   * `AgentState.attempt`: the reducer resets `attempt` to 0 on every
   * `planned` event (correctly — a fresh ACT/VERIFY cycle should start
   * with a clean slate), which means it cannot carry a count *across*
   * those cycles the way this field-level retry cap needs to.
   */
  readonly cursorAttempts: number;
  readonly pendingDecision?: AgentDecision;
  /** What ACT is about to write (or, for a declined review, the empty write it expects to see). */
  readonly pendingWrite?: { readonly fieldId: FieldId; readonly value: string };
  /** Set once a `request_review` pause resolves; undefined while still waiting. */
  readonly reviewApproved?: boolean;
}

export interface LoopPorts {
  readonly tools: ToolRegistry;
  readonly policy: PolicyEngine;
  readonly memory: Pick<MemoryStore, "get" | "search">;
  readonly userMemory: Pick<MemoryStore, "get" | "set">;
  readonly ontology: ConceptIndex;
  readonly llm?: LLMProvider;
  readonly verifier: Verifier;
  readonly files?: FileComplianceAdapter;
  readonly profileId: ProfileId;
  readonly clock: () => string;
  readonly generateId: () => string;
  readonly logger: Logger;
  readonly journal?: {
    recordUnresolvedField(
      input: {
        readonly origin: string;
        readonly fieldKey: string;
        readonly label: string;
        readonly kind: FormField["kind"];
        readonly autocomplete?: string;
        readonly tiersTried: readonly MatchResult["candidates"][number]["tier"][];
        readonly certainty: "unknown" | "ambiguous";
        readonly now: string;
      },
      memoryValues: readonly string[],
    ): Promise<boolean> | boolean;
  };
}

/** A field-cycle gets this many attempts (tool retries, verify retries) before PLAN gives up on it. */
const MAX_FIELD_ATTEMPTS = 2;
/** `drive`'s bound: legal-but-unproductive transitions must not hang the caller forever. */
const MAX_STEPS_PER_DRIVE = 500;
const FILL_RISK = ActionRisk.MEDIUM;

interface InspectFormResult {
  readonly forms: readonly Form[];
}

interface FillFieldInput {
  readonly fieldId: FieldId;
  readonly value: string;
}

interface UploadFileInput {
  readonly fieldId: FieldId;
  readonly ref: FileReference;
  readonly constraints: readonly FieldConstraint[];
}

export const createRun = (
  ports: Pick<LoopPorts, "clock" | "generateId">,
  origin: string,
  tabId: number,
): RunSnapshot => {
  const now = ports.clock();
  return {
    run: {
      id: ports.generateId(),
      createdAt: now,
      updatedAt: now,
      origin,
      state: initialState,
      steps: [],
    },
    tabId,
    fields: [],
    matches: {},
    values: {},
    handled: [],
    cursor: null,
    cursorAttempts: 0,
  };
};

const contextFor = (snapshot: RunSnapshot, ports: LoopPorts): ToolContext => ({
  runId: snapshot.run.id,
  origin: snapshot.run.origin,
  logger: ports.logger,
  signal: new AbortController().signal,
});

const applyEvent = (
  snapshot: RunSnapshot,
  event: AgentEvent,
  ports: LoopPorts,
  extra: Partial<Pick<AgentStep, "toolName">> = {},
): RunSnapshot => {
  const state = reduce(snapshot.run.state, event);
  const now = ports.clock();

  const step: AgentStep = {
    index: snapshot.run.steps.length,
    phase: state.phase,
    startedAt: now,
    endedAt: now,
    ...(event.type === "planned" ? { decision: event.decision } : {}),
    ...("ok" in event ? { ok: event.ok } : {}),
    ...(event.type === "failed" ? { errorCode: event.errorCode } : {}),
    ...extra,
  };

  ports.logger.debug("agent step", {
    runId: snapshot.run.id,
    phase: state.phase,
    status: state.status,
    stepIndex: step.index,
  });

  return {
    ...snapshot,
    run: {
      ...snapshot.run,
      state,
      updatedAt: now,
      steps: [...snapshot.run.steps, step],
    },
  };
};

// --- OBSERVE -----------------------------------------------------------------

const observeStep = async (
  snapshot: RunSnapshot,
  ports: LoopPorts,
): Promise<RunSnapshot> => {
  const result = await executeTool(
    ports.tools,
    INSPECT_FORM_TOOL,
    {},
    contextFor(snapshot, ports),
  );

  if (!result.ok) {
    return applyEvent(
      snapshot,
      { type: "failed", errorCode: "OBSERVE_FAILED" },
      ports,
    );
  }

  const forms = (result.value as InspectFormResult).forms;
  const fields = forms.flatMap((form) => form.fields);
  const documentLocale = forms[0]?.documentLocale;
  return applyEvent(
    { ...snapshot, fields, documentLocale },
    { type: "observed" },
    ports,
  );
};

// --- UNDERSTAND ----------------------------------------------------------------

const understandStep = async (
  snapshot: RunSnapshot,
  ports: LoopPorts,
): Promise<RunSnapshot> => {
  const matches: Record<FieldId, MatchResult> = {};
  for (const field of snapshot.fields) {
    const deterministic = resolve(
      field,
      ports.ontology,
      snapshot.documentLocale,
    );
    if (!ports.llm || deterministic.certainty === Certainty.KNOWN) {
      matches[field.id] = deterministic;
      continue;
    }

    matches[field.id] = await mapFieldWithModel(
      ports.llm,
      {
        fieldSummaries: snapshot.fields,
        field,
        concepts: ports.ontology.all,
      },
      ports.ontology,
    );
  }

  if (ports.journal) {
    const memoryValues = (
      await ports.memory.search({ profileId: ports.profileId })
    )
      .map((item) => item.value)
      .filter((value): value is string => typeof value === "string");

    for (const field of snapshot.fields) {
      const match = matches[field.id];
      if (
        !match ||
        (match.certainty !== Certainty.UNKNOWN &&
          match.certainty !== Certainty.AMBIGUOUS)
      ) {
        continue;
      }
      const label = field.label ?? field.name ?? field.placeholder ?? field.id;
      await ports.journal.recordUnresolvedField(
        {
          origin: snapshot.run.origin,
          fieldKey: field.id,
          label,
          kind: field.kind,
          autocomplete: field.autocomplete,
          tiersTried: match.candidates.map((candidate) => candidate.tier),
          certainty: match.certainty,
          now: ports.clock(),
        },
        memoryValues,
      );
    }
  }

  return applyEvent({ ...snapshot, matches }, { type: "understood" }, ports);
};

// --- RETRIEVE ------------------------------------------------------------------

const retrieveValuesFor = async (
  fields: readonly FormField[],
  matches: Readonly<Record<FieldId, MatchResult>>,
  ports: LoopPorts,
  documentLocale?: string,
): Promise<Record<FieldId, RetrievedValue | undefined>> => {
  const values: Record<FieldId, RetrievedValue | undefined> = {};

  for (const field of fields) {
    const match = matches[field.id];
    if (!match || match.certainty !== Certainty.KNOWN) continue;

    const candidate = match.candidates[0];
    const concept = candidate
      ? ports.ontology.byKey(candidate.conceptKey)
      : undefined;
    if (!candidate || !concept) continue;

    const nowIso = ports.clock();
    const resolvedItem = await resolveMemoryItemForConcept(
      concept,
      ports.memory,
      ports.profileId,
      nowIso,
    );
    const item = resolvedItem?.sourceItem;
    if (!resolvedItem || !item) continue;

    const isStale = freshness(item, nowIso) === FreshnessStatus.DUE;
    const confidence = isStale
      ? ConfidenceLevel.LOW
      : tierToConfidence(candidate.tier);
    const resolved = resolveStoredValueForField(
      field,
      resolvedItem.value,
      concept,
      confidence,
      documentLocale,
    );
    if (resolved.kind !== "fillable") continue;

    const displayValue = resolvedItem.displayPrefix
      ? `${resolvedItem.displayPrefix}: ${resolved.displayValue}`
      : resolved.displayValue;

    values[field.id] = {
      value: resolvedItem.value,
      payload: resolved.payload,
      displayValue,
      conceptKey: concept.key,
      sensitivity: concept.sensitivity,
      confidence: resolved.confidence,
      memoryWrite: resolved.memoryWrite ?? resolvedItem.memoryWrite,
      confirmedInRun: false,
      stale: isStale,
    };
  }

  return values;
};

const retrieveStep = async (
  snapshot: RunSnapshot,
  ports: LoopPorts,
): Promise<RunSnapshot> => {
  const values = await retrieveValuesFor(
    snapshot.fields,
    snapshot.matches,
    ports,
    snapshot.documentLocale,
  );
  return applyEvent(
    { ...snapshot, values: { ...snapshot.values, ...values } },
    { type: "retrieved" },
    ports,
  );
};

// --- PLAN ------------------------------------------------------------------

const buildValueQuestion = (field: FormField, conceptLabel: string): string =>
  `What should go in "${field.label ?? field.name ?? field.id}"? (${conceptLabel})`;

const buildReviewQuestion = (field: FormField, value: string): string =>
  `Fill "${field.label ?? field.name ?? field.id}" with "${value}"?`;

const applyValueToMatchedConcept = (
  snapshot: RunSnapshot,
  conceptKey: string,
  value: RetrievedValue,
): Readonly<Record<FieldId, RetrievedValue | undefined>> => {
  const values: Record<FieldId, RetrievedValue | undefined> = {
    ...snapshot.values,
  };

  for (const field of snapshot.fields) {
    const matchedKey = snapshot.matches[field.id]?.candidates[0]?.conceptKey;
    if (matchedKey === conceptKey) values[field.id] = value;
  }

  return values;
};

interface PlanResult {
  readonly decision: AgentDecision;
  readonly cursor: FieldId | null;
  readonly skipped: readonly FieldId[];
}

const pickNextAction = (
  snapshot: RunSnapshot,
  ports: LoopPorts,
): PlanResult => {
  const skipped: FieldId[] = [];
  const handledSet = new Set(snapshot.handled);

  // The field PLAN is revisiting after a failed verification. Past the
  // attempt cap, give up on it rather than retrying forever.
  if (
    snapshot.cursor !== null &&
    snapshot.cursorAttempts >= MAX_FIELD_ATTEMPTS &&
    !handledSet.has(snapshot.cursor)
  ) {
    skipped.push(snapshot.cursor);
    handledSet.add(snapshot.cursor);
  }

  for (const field of snapshot.fields) {
    if (handledSet.has(field.id)) continue;

    const match = snapshot.matches[field.id];
    if (!match || match.certainty !== Certainty.KNOWN) {
      // Unknown/ambiguous fields are reported, never guessed at: there is no
      // model yet to arbitrate an ambiguity, and inventing a "which concept
      // is this" UI is out of scope for this phase. Matches 1c's existing
      // behaviour — these fields are left alone, not silently filled.
      skipped.push(field.id);
      handledSet.add(field.id);
      continue;
    }

    const candidate = match.candidates[0];
    const concept = candidate
      ? ports.ontology.byKey(candidate.conceptKey)
      : undefined;
    if (!candidate || !concept) {
      skipped.push(field.id);
      handledSet.add(field.id);
      continue;
    }

    const existing = snapshot.values[field.id];
    if (!existing) {
      if (concept.key === "identity.age") {
        skipped.push(field.id);
        handledSet.add(field.id);
        continue;
      }
      return {
        decision: {
          action: {
            type: "ask_user",
            question: buildValueQuestion(field, concept.label),
            fieldId: field.id,
          },
          rationale: `"${concept.key}" matched this field, but no stored value exists.`,
          certainty: Certainty.REQUIRES_CONFIRMATION,
        },
        cursor: field.id,
        skipped,
      };
    }

    const confidence = existing.confidence;
    const policyDecision = ports.policy.evaluate({
      risk: FILL_RISK,
      sensitivity: concept.sensitivity,
      confidence,
      isSubmission: false,
      userConfirmed: existing.confirmedInRun ?? false,
    });

    if (policyDecision.effect === PolicyEffect.DENY) {
      skipped.push(field.id);
      handledSet.add(field.id);
      continue;
    }

    if (policyDecision.effect === PolicyEffect.ALLOW) {
      if (existing.payload.kind === "file") {
        const input: UploadFileInput = {
          fieldId: field.id,
          ref: existing.payload.ref,
          constraints: field.constraints,
        };
        return {
          decision: {
            action: { type: "call_tool", tool: UPLOAD_FILE_TOOL, input },
            rationale: policyDecision.reason,
            certainty: Certainty.KNOWN,
          },
          cursor: field.id,
          skipped,
        };
      }

      const input: FillFieldInput = {
        fieldId: field.id,
        value: existing.payload.value,
      };
      return {
        decision: {
          action: { type: "call_tool", tool: FILL_FIELD_TOOL, input },
          rationale: policyDecision.reason,
          certainty: Certainty.KNOWN,
        },
        cursor: field.id,
        skipped,
      };
    }

    return {
      decision: {
        action: { type: "request_review" },
        rationale: policyDecision.reason,
        certainty: Certainty.REQUIRES_CONFIRMATION,
      },
      cursor: field.id,
      skipped,
    };
  }

  return {
    decision: {
      action: { type: "finish", summary: "No more fields need action." },
      rationale:
        "Every field is filled, skipped as unresolvable, or handled and confirmed.",
      certainty: Certainty.KNOWN,
    },
    cursor: null,
    skipped,
  };
};

const planStep = (snapshot: RunSnapshot, ports: LoopPorts): RunSnapshot => {
  const { decision, cursor, skipped } = pickNextAction(snapshot, ports);
  const handled =
    skipped.length === 0
      ? snapshot.handled
      : [...new Set([...snapshot.handled, ...skipped])];

  const next: RunSnapshot = {
    ...snapshot,
    handled,
    cursor,
    // A fresh field starts a fresh retry count; re-deciding the *same*
    // field (a failed-verification retry) keeps whatever it had accrued.
    cursorAttempts: cursor === snapshot.cursor ? snapshot.cursorAttempts : 0,
    pendingDecision: decision,
    pendingWrite: undefined,
    reviewApproved: undefined,
  };

  return applyEvent(next, { type: "planned", decision }, ports);
};

// --- ACT -----------------------------------------------------------------------

const performFill = async (
  snapshot: RunSnapshot,
  fieldId: FieldId,
  value: string,
  ports: LoopPorts,
): Promise<RunSnapshot> => {
  const input: FillFieldInput = { fieldId, value };
  const result = await executeTool(
    ports.tools,
    FILL_FIELD_TOOL,
    input,
    contextFor(snapshot, ports),
  );

  const withWrite: RunSnapshot = {
    ...snapshot,
    pendingWrite: { fieldId, value },
  };

  if (!result.ok) {
    // A genuine pipeline failure — schema-invalid input, the tool threw, the
    // message channel is dead. Worth retrying at the ACT level (transient
    // errors are exactly what that retry exists for).
    return applyEvent(withWrite, { type: "acted", ok: false }, ports, {
      toolName: FILL_FIELD_TOOL,
    });
  }

  // The pipeline succeeded either way. A control `writeFieldValue` cannot
  // write (for example, the controlled.html combobox) still returns
  // successfully here, carrying `{ ok: false }` as *data* — that is not a
  // pipeline problem to retry, it is VERIFY's job to notice (as
  // NOT_APPLIED) and PLAN's job to give up on after repeated failures,
  // exactly like any other value the page silently rejected.
  return applyEvent(withWrite, { type: "acted", ok: true }, ports, {
    toolName: FILL_FIELD_TOOL,
  });
};

const performFileUpload = async (
  snapshot: RunSnapshot,
  field: FormField,
  ref: FileReference,
  ports: LoopPorts,
): Promise<RunSnapshot> => {
  const withWrite: RunSnapshot = {
    ...snapshot,
    pendingWrite: { fieldId: field.id, value: ref.name },
  };

  const input: UploadFileInput = {
    fieldId: field.id,
    ref,
    constraints: field.constraints,
  };
  const result = await executeTool(
    ports.tools,
    UPLOAD_FILE_TOOL,
    input,
    contextFor(snapshot, ports),
  );

  if (!result.ok) {
    return applyEvent(withWrite, { type: "acted", ok: false }, ports, {
      toolName: UPLOAD_FILE_TOOL,
    });
  }

  return applyEvent(withWrite, { type: "acted", ok: true }, ports, {
    toolName: UPLOAD_FILE_TOOL,
  });
};

const retryAct = async (
  snapshot: RunSnapshot,
  ports: LoopPorts,
  decision: AgentDecision,
): Promise<RunSnapshot> => {
  if (decision.action.type === "call_tool") {
    if (decision.action.tool === UPLOAD_FILE_TOOL) {
      const input = decision.action.input as UploadFileInput;
      const field = snapshot.fields.find((f) => f.id === input.fieldId);
      const value = field ? snapshot.values[input.fieldId] : undefined;
      if (!field || value?.payload.kind !== "file") {
        return applyEvent(
          snapshot,
          { type: "failed", errorCode: "UPLOAD_FILE_MISSING_REFERENCE" },
          ports,
        );
      }
      return performFileUpload(snapshot, field, value.payload.ref, ports);
    }

    const input = decision.action.input as FillFieldInput;
    return performFill(snapshot, input.fieldId, input.value, ports);
  }

  if (decision.action.type === "ask_user") {
    const fieldId = decision.action.fieldId;
    const answered = fieldId ? snapshot.values[fieldId] : undefined;

    if (!answered) {
      return applyEvent(
        snapshot,
        { type: "user_input_required", question: decision.action.question },
        ports,
      );
    }
    if (!fieldId) {
      return applyEvent(
        snapshot,
        { type: "failed", errorCode: "ASK_USER_MISSING_FIELD" },
        ports,
      );
    }
    const field = snapshot.fields.find((f) => f.id === fieldId);
    if (field && answered.payload.kind === "file") {
      return performFileUpload(snapshot, field, answered.payload.ref, ports);
    }
    if (answered.payload.kind === "text") {
      return performFill(snapshot, fieldId, answered.payload.value, ports);
    }
    return applyEvent(
      snapshot,
      { type: "failed", errorCode: "ASK_USER_UNSUPPORTED_PAYLOAD" },
      ports,
    );
  }

  if (decision.action.type === "request_review") {
    const fieldId = snapshot.cursor;
    if (!fieldId) {
      return applyEvent(
        snapshot,
        { type: "failed", errorCode: "REVIEW_MISSING_FIELD" },
        ports,
      );
    }

    if (snapshot.reviewApproved === undefined) {
      const value = snapshot.values[fieldId];
      const field = snapshot.fields.find((f) => f.id === fieldId);
      const question =
        field && value
          ? buildReviewQuestion(field, value.displayValue)
          : "Confirm this fill?";
      return applyEvent(
        snapshot,
        { type: "user_input_required", question },
        ports,
      );
    }

    if (!snapshot.reviewApproved) {
      // Declined: nothing gets written. VERIFY still runs, checking the
      // field stayed empty — a decline and a fill both flow through the
      // same "did reality match intent" check, with intent just being "".
      return applyEvent(
        { ...snapshot, pendingWrite: { fieldId, value: "" } },
        { type: "acted", ok: true },
        ports,
      );
    }

    const value = snapshot.values[fieldId];
    if (!value) {
      return applyEvent(
        snapshot,
        { type: "failed", errorCode: "REVIEW_MISSING_VALUE" },
        ports,
      );
    }

    // Re-run policy with userConfirmed: true rather than trusting the
    // earlier REQUIRE_CONFIRMATION outcome — mirrors `confirmDecision` in
    // `~/core/fill/driver`.
    const confidence = value.confidence;
    const reconfirmed = ports.policy.evaluate({
      risk: FILL_RISK,
      sensitivity: value.sensitivity,
      confidence,
      isSubmission: false,
      userConfirmed: true,
    });

    if (reconfirmed.effect !== PolicyEffect.ALLOW) {
      return applyEvent(
        snapshot,
        { type: "failed", errorCode: "REVIEW_POLICY_DENIED" },
        ports,
      );
    }

    const fieldValue = snapshot.values[fieldId];
    if (fieldValue && fieldValue.memoryWrite !== false) {
      const memoryKey = fieldValue.memoryWrite?.key ?? fieldValue.conceptKey;
      const memoryValue = fieldValue.memoryWrite?.value ?? fieldValue.value;
      const concept = ports.ontology.byKey(memoryKey);
      const horizon =
        concept && !isFileReference(memoryValue)
          ? deriveFreshnessHorizon(
              concept,
              memoryValue,
              ports.clock(),
              bundledFreshnessDurationPolicy,
            )
          : undefined;
      await recordAnswer(ports.userMemory, {
        profileId: ports.profileId,
        key: memoryKey,
        value: memoryValue,
        source: MemorySource.USER_CONFIRMED,
        now: ports.clock(),
        expiresAt: horizon?.expiresAt,
        freshnessRule: horizon?.freshnessRule,
      });
    }

    const field = snapshot.fields.find((f) => f.id === fieldId);
    if (field && value.payload.kind === "file") {
      return performFileUpload(snapshot, field, value.payload.ref, ports);
    }

    if (value.payload.kind === "text") {
      return performFill(snapshot, fieldId, value.payload.value, ports);
    }

    return applyEvent(
      snapshot,
      { type: "failed", errorCode: "REVIEW_UNSUPPORTED_PAYLOAD" },
      ports,
    );
  }

  // "finish" never reaches ACT: `reduce` sends a finish decision straight to
  // DONE from PLAN.
  return applyEvent(
    snapshot,
    { type: "failed", errorCode: "UNEXPECTED_ACT_DECISION" },
    ports,
  );
};

const actStep = async (
  snapshot: RunSnapshot,
  ports: LoopPorts,
): Promise<RunSnapshot> => {
  const { state } = snapshot.run;

  // Waiting on an external answer/confirmation — nothing to do until
  // `answerQuestion`/`confirmReview` moves status off WAITING_FOR_USER.
  if (state.status === AgentStatus.WAITING_FOR_USER) return snapshot;

  const decision = snapshot.pendingDecision;
  if (!decision) {
    return applyEvent(
      snapshot,
      { type: "failed", errorCode: "ACT_MISSING_DECISION" },
      ports,
    );
  }

  if (state.attempt > MAX_FIELD_ATTEMPTS) {
    return applyEvent(
      snapshot,
      { type: "failed", errorCode: "ACT_RETRY_EXHAUSTED" },
      ports,
    );
  }

  return retryAct(snapshot, ports, decision);
};

// --- VERIFY ----------------------------------------------------------------

const verifyStep = async (
  snapshot: RunSnapshot,
  ports: LoopPorts,
): Promise<RunSnapshot> => {
  const write = snapshot.pendingWrite;
  if (!write) {
    return applyEvent(
      snapshot,
      { type: "failed", errorCode: "VERIFY_MISSING_INTENT" },
      ports,
    );
  }

  const result = await ports.verifier.verify({
    fieldId: write.fieldId,
    expectedValue: write.value,
  });

  // Re-extract rather than trusting the observation PLAN last saw — this is
  // the re-observation `dynamic.html` exists to demand, and the only way to
  // detect a FORM_CHANGED issue.
  const fresh = await executeTool(
    ports.tools,
    INSPECT_FORM_TOOL,
    {},
    contextFor(snapshot, ports),
  );
  const freshForms = fresh.ok
    ? (fresh.value as InspectFormResult).forms
    : undefined;
  const freshFields = freshForms
    ? freshForms.flatMap((form) => form.fields)
    : snapshot.fields;
  const documentLocale = freshForms
    ? freshForms[0]?.documentLocale
    : snapshot.documentLocale;

  const knownIds = new Set(snapshot.fields.map((field) => field.id));
  const newFields = freshFields.filter((field) => !knownIds.has(field.id));

  let matches = snapshot.matches;
  let values = snapshot.values;
  const formChanged = newFields.length > 0;

  if (formChanged) {
    ports.logger.debug("form changed after action", {
      runId: snapshot.run.id,
      fieldId: write.fieldId,
      count: newFields.length,
    });

    const newMatches: Record<FieldId, MatchResult> = {};
    for (const field of newFields) {
      const deterministic = resolve(field, ports.ontology, documentLocale);
      newMatches[field.id] =
        ports.llm && deterministic.certainty !== Certainty.KNOWN
          ? await mapFieldWithModel(
              ports.llm,
              {
                fieldSummaries: freshFields,
                field,
                concepts: ports.ontology.all,
              },
              ports.ontology,
            )
          : deterministic;
    }
    matches = { ...matches, ...newMatches };

    const newValues = await retrieveValuesFor(
      newFields,
      newMatches,
      ports,
      documentLocale,
    );
    values = { ...values, ...newValues };
  }

  // Whether *this field's own write* succeeded — drives whether it gets
  // marked handled. A concurrent FORM_CHANGED must not stop a field that
  // verified cleanly from being marked done, or it would be reconsidered
  // forever every time the page grows a new field. FORM_CHANGED is still
  // folded into the reported `ok` below, so it shows up in the step log and
  // routes the run back to PLAN rather than straight to ACT either way.
  const fieldOk = result.ok;
  const ok = fieldOk && !formChanged;

  const nextSnapshot: RunSnapshot = {
    ...snapshot,
    fields: freshFields,
    documentLocale,
    matches,
    values,
    handled: fieldOk ? [...snapshot.handled, write.fieldId] : snapshot.handled,
    cursor: fieldOk ? null : snapshot.cursor,
    cursorAttempts: fieldOk ? 0 : snapshot.cursorAttempts + 1,
    pendingDecision: fieldOk ? undefined : snapshot.pendingDecision,
    pendingWrite: undefined,
    reviewApproved: undefined,
  };

  return applyEvent(nextSnapshot, { type: "verified", ok }, ports);
};

// --- the public surface ---------------------------------------------------------

/** Performs exactly one phase's worth of work. */
export const step = async (
  snapshot: RunSnapshot,
  ports: LoopPorts,
): Promise<RunSnapshot> => {
  if (isTerminal(snapshot.run.state.status)) return snapshot;

  switch (snapshot.run.state.phase) {
    case AgentPhase.OBSERVE:
      return observeStep(snapshot, ports);
    case AgentPhase.UNDERSTAND:
      return understandStep(snapshot, ports);
    case AgentPhase.RETRIEVE:
      return retrieveStep(snapshot, ports);
    case AgentPhase.PLAN:
      return planStep(snapshot, ports);
    case AgentPhase.ACT:
      return actStep(snapshot, ports);
    case AgentPhase.VERIFY:
      return verifyStep(snapshot, ports);
    case AgentPhase.DONE:
      return snapshot;
    default:
      return snapshot;
  }
};

/**
 * Steps repeatedly until the run is terminal, paused, or waiting on the
 * user — the unit of work a caller actually wants ("run this as far as it
 * can go right now"), with `step` staying the unit that's individually
 * testable and individually resumable.
 */
export const drive = async (
  snapshot: RunSnapshot,
  ports: LoopPorts,
): Promise<RunSnapshot> => {
  let current = snapshot;

  for (let i = 0; i < MAX_STEPS_PER_DRIVE; i++) {
    const { status } = current.run.state;
    if (
      isTerminal(status) ||
      status === AgentStatus.WAITING_FOR_USER ||
      status === AgentStatus.PAUSED
    ) {
      return current;
    }
    current = await step(current, ports);
  }

  return current;
};

/**
 * Resolves an `ask_user` pause. The answer is written through the explicit
 * user-memory write service, never through `executeTool`, before the run
 * resumes. If the field's concept can no longer be resolved (should not
 * happen; defensive), the run still resumes but the value is discarded
 * rather than recorded under a guessed key.
 */
export const answerQuestion = async (
  snapshot: RunSnapshot,
  ports: LoopPorts,
  value: string | FileReference,
): Promise<RunSnapshot> => {
  if (snapshot.run.state.status !== AgentStatus.WAITING_FOR_USER)
    return snapshot;

  const fieldId = snapshot.cursor;
  const decision = snapshot.pendingDecision;
  if (!fieldId || !decision || decision.action.type !== "ask_user")
    return snapshot;

  const field = snapshot.fields.find((f) => f.id === fieldId);
  const candidate = snapshot.matches[fieldId]?.candidates[0];
  const concept = candidate
    ? ports.ontology.byKey(candidate.conceptKey)
    : undefined;

  if (concept) {
    const confirmationTime = ports.clock();
    const horizon = deriveFreshnessHorizon(
      concept,
      value,
      confirmationTime,
      bundledFreshnessDurationPolicy,
    );
    await recordAnswer(ports.userMemory, {
      profileId: ports.profileId,
      key: concept.key,
      value,
      label: field?.label,
      source: MemorySource.USER_PROVIDED,
      now: confirmationTime,
      expiresAt: horizon.expiresAt,
      freshnessRule: horizon.freshnessRule,
    });
  }

  const values = concept
    ? (() => {
        if (!field) return snapshot.values;
        const resolved = resolveStoredValueForField(
          field,
          value,
          concept,
          ConfidenceLevel.CERTAIN,
          snapshot.documentLocale,
        );
        if (resolved.kind !== "fillable") return snapshot.values;

        return applyValueToMatchedConcept(snapshot, concept.key, {
          value,
          payload: resolved.payload,
          displayValue: resolved.displayValue,
          conceptKey: concept.key,
          sensitivity: concept.sensitivity,
          confidence: resolved.confidence,
          memoryWrite: resolved.memoryWrite,
          confirmedInRun: true,
          stale: false,
        });
      })()
    : snapshot.values;

  return applyEvent({ ...snapshot, values }, { type: "user_responded" }, ports);
};

/** Resolves a `request_review` pause with the user's approve/decline choice. */
export const confirmReview = (
  snapshot: RunSnapshot,
  ports: LoopPorts,
  approve: boolean,
): RunSnapshot => {
  if (snapshot.run.state.status !== AgentStatus.WAITING_FOR_USER)
    return snapshot;
  return applyEvent(
    { ...snapshot, reviewApproved: approve },
    { type: "user_responded" },
    ports,
  );
};

/** What the panel needs to render a `request_review` pause, without exposing the whole snapshot. */
export const currentReview = (
  snapshot: RunSnapshot,
): {
  readonly fieldId: FieldId;
  readonly value: string;
  readonly label?: string;
} | null => {
  if (
    snapshot.pendingDecision?.action.type !== "request_review" ||
    !snapshot.cursor
  ) {
    return null;
  }
  const value = snapshot.values[snapshot.cursor];
  if (!value) return null;
  const field = snapshot.fields.find((f) => f.id === snapshot.cursor);
  return {
    fieldId: snapshot.cursor,
    value: value.displayValue,
    label: field?.label,
  };
};
