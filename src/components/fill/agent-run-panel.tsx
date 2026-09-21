import { FileUp, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { AgentStatus } from "~/core/agent/types";
import { acceptsFileReference, maxFileSizeBytes } from "~/core/files/types";
import type { FieldConstraint } from "~/core/form/types";
import type { FileReference } from "~/core/memory/types";
import { createIndexedDbFileReferenceStore } from "~/lib/files/adapters";
import type { RunView } from "~/lib/messaging";
import { sendMessage } from "~/lib/messaging";
import { useSound } from "~/lib/sfx/react";
import { cn } from "~/lib/utils";

/**
 * The Phase 2 agent loop, alongside (not replacing) the straight-line
 * scan/confirm flow above it in `FillPanel`. That flow stays exactly as it
 * is — its e2e coverage depends on it — while this is a separate surface
 * for the run/reducer/verify path phase 2 adds. Two different ways to fill
 * the same page is not the end state; it is what "alongside" means until a
 * later phase decides which one the product actually ships.
 *
 * Nests inside the known-fields summary card in `FillPanel` when some
 * detected fields still need answers (no value / ambiguous).
 */

interface AgentRunPanelProps {
  readonly tabId: number | undefined;
}

export const AgentRunPanel = ({ tabId }: AgentRunPanelProps) => {
  const sound = useSound();
  const fileInputId = useId();
  const [view, setView] = useState<RunView | null>(null);
  const [answer, setAnswer] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastAttentionRunId = useRef<string | null>(null);

  const playRunStateCue = (nextView: RunView | null) => {
    if (!nextView) return;
    if (nextView.status === AgentStatus.COMPLETED) {
      sound.play("agentCompleted");
      return;
    }
    if (nextView.status === AgentStatus.FAILED) {
      sound.play("agentFailed");
      return;
    }
    if (
      nextView.status === AgentStatus.WAITING_FOR_USER &&
      lastAttentionRunId.current !== nextView.runId
    ) {
      lastAttentionRunId.current = nextView.runId;
      sound.play("agentNeedsAttention");
    }
  };

  const start = async () => {
    if (tabId === undefined) return;
    setBusy(true);
    sound.startLoop("agent-run", "agentBusy");
    try {
      const result = await sendMessage("startRun", { tabId });
      setView(result.view);
      sound.stopLoop("agent-run");
      if (result.started) sound.play("agentStarted");
      else sound.play("scanBlocked");
      playRunStateCue(result.view);
    } catch {
      sound.stopLoop("agent-run");
      sound.play("agentFailed");
    } finally {
      sound.stopLoop("agent-run");
      setBusy(false);
    }
  };

  const acceptLabel = (constraints: readonly FieldConstraint[]): string => {
    const accept = constraints.find(
      (constraint) => constraint.kind === "accept",
    );
    return accept ? accept.value.join(", ") : "Any file type";
  };

  const validateFile = (
    file: File,
    constraints: readonly FieldConstraint[],
  ): string | null => {
    const ref: FileReference = {
      kind: "file_ref",
      id: "pending-selection",
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      createdAt: new Date(0).toISOString(),
    };
    if (!acceptsFileReference(ref, constraints)) {
      return `Choose a file matching ${acceptLabel(constraints)}.`;
    }
    const maxBytes = maxFileSizeBytes(constraints);
    if (maxBytes !== undefined && file.size > maxBytes) {
      return `Choose a file up to ${Math.round(maxBytes / 1024)} KB.`;
    }
    return null;
  };

  const chooseFile = (
    file: File | undefined,
    constraints: readonly FieldConstraint[],
  ) => {
    if (!file) return;
    const error = validateFile(file, constraints);
    setSelectedFile(error ? null : file);
    setFileError(error);
    if (error) sound.play("agentFailed");
  };

  const submitAnswerValue = async (
    value: string | FileReference,
  ): Promise<boolean> => {
    if (tabId === undefined) return false;
    setBusy(true);
    sound.startLoop("agent-run", "agentBusy");
    try {
      const result = await sendMessage("answerRunQuestion", {
        tabId,
        value,
      });
      setView(result.view);
      setAnswer("");
      setSelectedFile(null);
      setFileError(null);
      sound.stopLoop("agent-run");
      sound.play(result.ok ? "agentAnswerSent" : "agentFailed");
      playRunStateCue(result.view);
      return result.ok;
    } catch {
      sound.stopLoop("agent-run");
      sound.play("agentFailed");
      return false;
    } finally {
      sound.stopLoop("agent-run");
      setBusy(false);
    }
  };

  const submitTextAnswer = async () => {
    if (busy || !answer.trim()) return;
    await submitAnswerValue(answer);
  };

  const submitFileAnswer = async (
    file: File | null,
    constraints: readonly FieldConstraint[],
  ) => {
    if (busy || !file) return;
    const error = validateFile(file, constraints);
    if (error) {
      setFileError(error);
      sound.play("agentFailed");
      return;
    }
    setBusy(true);
    sound.startLoop("agent-run", "agentBusy");
    try {
      const store = await createIndexedDbFileReferenceStore();
      const ref = await store.save(file);
      const submitted = await submitAnswerValue(ref);
      if (!submitted) await store.delete(ref.id);
    } catch {
      sound.stopLoop("agent-run");
      sound.play("agentFailed");
      setFileError("Could not save that file.");
    } finally {
      sound.stopLoop("agent-run");
      setBusy(false);
    }
  };

  const respondToReview = async (approve: boolean) => {
    if (tabId === undefined) return;
    setBusy(true);
    sound.startLoop("agent-run", "agentBusy");
    try {
      const result = await sendMessage("confirmRunReview", { tabId, approve });
      setView(result.view);
      sound.stopLoop("agent-run");
      sound.play(
        result.ok
          ? approve
            ? "agentReviewConfirmed"
            : "agentReviewSkipped"
          : "agentFailed",
      );
      playRunStateCue(result.view);
    } catch {
      sound.stopLoop("agent-run");
      sound.play("agentFailed");
    } finally {
      sound.stopLoop("agent-run");
      setBusy(false);
    }
  };

  return (
    <>
      {!view && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={start}
        >
          Answer now and never again
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
        view.pendingQuestion &&
        (view.pendingInput?.kind === "file" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{view.pendingQuestion}</p>
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submitFileAnswer(
                  selectedFile,
                  view.pendingInput?.kind === "file"
                    ? view.pendingInput.constraints
                    : [],
                );
              }}
            >
              <label
                htmlFor={fileInputId}
                className={cn(
                  "flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 text-center transition-colors hover:border-primary/60 hover:bg-accent/35",
                  dragActive && "border-primary/70 bg-accent/45",
                  busy && "cursor-not-allowed opacity-60",
                )}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  chooseFile(
                    event.dataTransfer.files[0],
                    view.pendingInput?.kind === "file"
                      ? view.pendingInput.constraints
                      : [],
                  );
                }}
              >
                <FileUp className="size-5 text-muted-foreground" />
                <span className="font-medium text-sm">
                  Browse or drag a file here
                </span>
                <span className="text-muted-foreground text-xs">
                  {acceptLabel(view.pendingInput.constraints)}
                </span>
              </label>
              <Input
                id={fileInputId}
                type="file"
                className="sr-only"
                accept={view.pendingInput.accept?.join(",")}
                disabled={busy}
                onChange={(event) =>
                  chooseFile(
                    event.target.files?.[0],
                    view.pendingInput?.kind === "file"
                      ? view.pendingInput.constraints
                      : [],
                  )
                }
              />
              {selectedFile && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-xs">
                  <span className="min-w-0 truncate">
                    {selectedFile.name} · {Math.round(selectedFile.size / 1024)}{" "}
                    KB
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    onClick={() => {
                      setSelectedFile(null);
                      setFileError(null);
                    }}
                    aria-label="Remove selected file"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              )}
              {fileError && (
                <p className="text-destructive text-xs">{fileError}</p>
              )}
              <Button
                type="submit"
                size="sm"
                disabled={busy || selectedFile === null}
              >
                Answer
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{view.pendingQuestion}</p>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submitTextAnswer();
              }}
            >
              <Input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Your answer"
              />
              <Button type="submit" size="sm" disabled={busy || !answer.trim()}>
                Answer
              </Button>
            </form>
          </div>
        ))}

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
    </>
  );
};
