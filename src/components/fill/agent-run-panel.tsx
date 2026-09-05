import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { AgentStatus } from "~/core/agent/types";
import type { RunView } from "~/lib/messaging";
import { sendMessage } from "~/lib/messaging";

/**
 * The Phase 2 agent loop, alongside (not replacing) the straight-line
 * scan/confirm flow above it in `FillPanel`. That flow stays exactly as it
 * is — its e2e coverage depends on it — while this is a separate surface
 * for the run/reducer/verify path phase 2 adds. Two different ways to fill
 * the same page is not the end state; it is what "alongside" means until a
 * later phase decides which one the product actually ships.
 *
 * Placeholder styling — see docs/roadmap/_context.md.
 */

interface AgentRunPanelProps {
  readonly tabId: number | undefined;
}

export const AgentRunPanel = ({ tabId }: AgentRunPanelProps) => {
  const [view, setView] = useState<RunView | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (tabId === undefined) return;
    setBusy(true);
    try {
      const result = await sendMessage("startRun", { tabId });
      setView(result.view);
    } finally {
      setBusy(false);
    }
  };

  const submitAnswer = async () => {
    if (tabId === undefined || !answer.trim()) return;
    setBusy(true);
    try {
      const result = await sendMessage("answerRunQuestion", {
        tabId,
        value: answer,
      });
      setView(result.view);
      setAnswer("");
    } finally {
      setBusy(false);
    }
  };

  const respondToReview = async (approve: boolean) => {
    if (tabId === undefined) return;
    setBusy(true);
    try {
      const result = await sendMessage("confirmRunReview", { tabId, approve });
      setView(result.view);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border border-dashed p-3">
      {/* TODO(design): placeholder — see docs/roadmap/_context.md */}
      <p className="font-medium text-xs">Agent loop (beta)</p>

      {!view && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={start}
        >
          Fill with agent
        </Button>
      )}

      {view && view.status === AgentStatus.WAITING_FOR_USER && view.review && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Fill{" "}
            <span className="font-medium">
              {view.review.label ?? view.review.fieldId}
            </span>{" "}
            with <span className="font-medium">{view.review.value}</span>?
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => respondToReview(true)}
            >
              Confirm
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => respondToReview(false)}
            >
              Skip
            </Button>
          </div>
        </div>
      )}

      {view &&
        view.status === AgentStatus.WAITING_FOR_USER &&
        !view.review &&
        view.pendingQuestion && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{view.pendingQuestion}</p>
            <div className="flex gap-2">
              <Input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Your answer"
              />
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={submitAnswer}
              >
                Answer
              </Button>
            </div>
          </div>
        )}

      {view && view.status === AgentStatus.COMPLETED && (
        <p className="text-muted-foreground text-sm">Run complete.</p>
      )}

      {view && view.status === AgentStatus.FAILED && (
        <p className="text-destructive text-sm">The run could not continue.</p>
      )}

      {view &&
        view.status !== AgentStatus.WAITING_FOR_USER &&
        view.status !== AgentStatus.COMPLETED &&
        view.status !== AgentStatus.FAILED && (
          <p className="text-muted-foreground text-xs">
            {view.phase} — {view.status}
          </p>
        )}
    </div>
  );
};
