import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { createShadowRootUi, defineContentScript } from "#imports";
import {
  DETECTION_NUDGE_AUTO_HIDE_MS,
  DetectionNudgeBanner,
} from "~/components/fill/detection-nudge-banner";
import type { FieldElements } from "~/lib/form/extract";
import { extractFullWithElements } from "~/lib/form/extract";
import { uploadFieldFile, writeFieldValue } from "~/lib/form/fill";
import { evaluateFormPageHeuristic } from "~/lib/form/form-page-heuristic";
import { compareFieldValue } from "~/lib/form/verify";
import {
  assertValidFillInstruction,
  assertValidUploadInstruction,
  onMessage,
  sendMessage,
} from "~/lib/messaging";

import "~/assets/styles/globals.css";

/**
 * Populated by the most recent `extractFullForm` message, consumed by
 * `fillField`. `FieldId`s are recomputed on every extraction rather than
 * stored as DOM attributes (see `~/core/form/field-id`), so a fill must
 * target the same extraction pass that produced the id it was given —
 * hence caching it here rather than re-extracting inside `fillField`.
 */
let lastElementsById: ReadonlyMap<string, FieldElements> = new Map();
const fillFeedbackEvent = "form-agent-fill-feedback";

/** Per-document: register + inject can both evaluate this file on one page. */
const handlersRegisteredAttr = "data-fill-my-form-handlers";
const passiveDetectionAttr = "data-fill-my-form-passive-detection";

const ensureHandlersRegistered = (): void => {
  const root = document.documentElement;
  if (root.hasAttribute(handlersRegisteredAttr)) return;
  root.setAttribute(handlersRegisteredAttr, "");
  registerFillHandlers();
};

const ensurePassiveDetectionStarted = (): void => {
  const root = document.documentElement;
  if (root.hasAttribute(passiveDetectionAttr)) return;
  root.setAttribute(passiveDetectionAttr, "");
  startPassiveDetection();
};

/**
 * Deliberately DOM-only, not a sticky flag: WXT invalidates an older script
 * instance (and removes its UI) when a newer one starts, so a flag set by the
 * older instance would leave the page with no UI at all.
 */
const shouldSkipUiMount = (): boolean =>
  document.querySelector("form-agent-ui") !== null;
const detectionNudgeEvent = "form-agent-detection-nudge";

interface FillFeedbackDetail {
  readonly filledCount: number;
}

interface DetectionNudgeDetail {
  readonly knownFieldCount: number;
  readonly answerCount: number;
}

const announceFillFeedback = (filledCount: number) => {
  window.dispatchEvent(
    new CustomEvent<FillFeedbackDetail>(fillFeedbackEvent, {
      detail: { filledCount },
    }),
  );
};

const announceDetectionNudge = (
  knownFieldCount: number,
  answerCount: number,
) => {
  window.dispatchEvent(
    new CustomEvent<DetectionNudgeDetail>(detectionNudgeEvent, {
      detail: { knownFieldCount, answerCount },
    }),
  );
};

const registerFillHandlers = () => {
  onMessage("extractFullForm", () => {
    const { forms, elements } = extractFullWithElements(document);
    lastElementsById = elements;
    return { forms };
  });

  onMessage("fillField", ({ data }) => {
    // Throws — fills nothing — without a `decisionId`. See
    // ~/core/messaging/fill-instruction for why this must stay here.
    const { fieldId, value } = assertValidFillInstruction(data);

    const target = lastElementsById.get(fieldId);
    if (!target) return { ok: false };

    return { ok: writeFieldValue(target, value) };
  });

  onMessage("uploadFile", ({ data }) => {
    const { fieldId, upload } = assertValidUploadInstruction(data);
    const target = lastElementsById.get(fieldId);
    if (!target) return { ok: false };

    return { ok: uploadFieldFile(target, upload) };
  });

  onMessage("showFillFeedback", ({ data }) => {
    announceFillFeedback(data.filledCount);
    return { ok: true };
  });

  onMessage("showFormDetectionNudge", ({ data }) => {
    announceDetectionNudge(data.knownFieldCount, data.answerCount);
    return { ok: true };
  });

  onMessage("verifyField", ({ data }) => {
    // Same cache `fillField` reads: a verify must check the same element the
    // fill wrote to, from the same extraction pass a `FieldId` came from.
    return compareFieldValue(
      lastElementsById.get(data.fieldId),
      data.expectedValue,
    );
  });

  onMessage("ackFormPageDetected", ({ data }) => {
    ackedGeneration = data.generation;
    return { ok: true };
  });
};

const DETECTION_DEBOUNCE_MS = 900;
let ackedGeneration = "";
let detectionTimer: number | undefined;

const schedulePassiveDetection = () => {
  if (detectionTimer !== undefined) {
    window.clearTimeout(detectionTimer);
  }
  detectionTimer = window.setTimeout(() => {
    detectionTimer = undefined;
    void runPassiveDetection();
  }, DETECTION_DEBOUNCE_MS);
};

const runPassiveDetection = async () => {
  const url = location.href;
  const generation = url;
  if (generation === ackedGeneration) return;

  const { mayDetect } = await sendMessage("getPageAccessForUrl", { url });
  if (!mayDetect) return;

  const heuristic = evaluateFormPageHeuristic(document);
  if (!heuristic.likelyFormPage) return;

  const { ack } = await sendMessage("formPageDetected", {
    url,
    reason: heuristic.reason,
    generation,
  });
  if (ack) ackedGeneration = generation;
};

const startPassiveDetection = () => {
  const onNavigate = () => {
    ackedGeneration = "";
    schedulePassiveDetection();
  };

  window.addEventListener("load", schedulePassiveDetection);
  window.addEventListener("pageshow", onNavigate);

  const observer = new MutationObserver(() => schedulePassiveDetection());
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  schedulePassiveDetection();
};

/**
 * `registration: "runtime"` keeps this script OUT of the manifest.
 *
 * A declared content script matching `<all_urls>` grants code injection into
 * every page at install time — which would undo the narrow permissions in
 * `wxt.config.ts` and show the user "read and change all your data on all
 * websites" regardless. Instead the background worker registers this script
 * for a specific origin once the user grants access to that site.
 *
 * See docs/privacy.md. `matches` below is the *upper bound* of what may ever
 * be registered, not what is granted.
 */
const ContentScriptUI = () => {
  const [fillFeedback, setFillFeedback] = useState<FillFeedbackDetail | null>(
    null,
  );
  const [detectionNudge, setDetectionNudge] =
    useState<DetectionNudgeDetail | null>(null);

  useEffect(() => {
    let hideTimer: number | undefined;
    const handleDetectionNudge = (event: Event) => {
      const detail = (event as CustomEvent<DetectionNudgeDetail>).detail;
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      setDetectionNudge(detail);
      hideTimer = window.setTimeout(() => {
        setDetectionNudge(null);
      }, DETECTION_NUDGE_AUTO_HIDE_MS);
    };

    window.addEventListener(detectionNudgeEvent, handleDetectionNudge);
    return () => {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      window.removeEventListener(detectionNudgeEvent, handleDetectionNudge);
    };
  }, []);

  useEffect(() => {
    let hideTimer: number | undefined;
    const handleFillFeedback = (event: Event) => {
      const { filledCount } = (event as CustomEvent<FillFeedbackDetail>).detail;
      if (filledCount <= 0) return;

      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      setFillFeedback({ filledCount });
      hideTimer = window.setTimeout(() => setFillFeedback(null), 1800);
    };

    window.addEventListener(fillFeedbackEvent, handleFillFeedback);
    return () => {
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      window.removeEventListener(fillFeedbackEvent, handleFillFeedback);
    };
  }, []);

  return (
    <>
      {detectionNudge && (
        <DetectionNudgeBanner
          knownFieldCount={detectionNudge.knownFieldCount}
          answerCount={detectionNudge.answerCount}
          onReview={() => {
            void sendMessage("openFillUiFromTab");
            setDetectionNudge(null);
          }}
          onDismiss={() => setDetectionNudge(null)}
        />
      )}
      {fillFeedback && (
        <div
          className="pointer-events-none fixed inset-x-4 top-6 z-[2147483647] flex justify-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-4 motion-safe:zoom-in-95 motion-safe:duration-300 motion-reduce:animate-none"
          aria-live="polite"
          data-testid="fill-feedback-banner"
        >
          <div className="relative min-w-64 max-w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-emerald-400/40 bg-background/95 px-4 py-3 text-foreground shadow-2xl shadow-black/25 ring-1 ring-border backdrop-blur">
            <div className="absolute inset-x-0 top-0 h-1 bg-emerald-500/20">
              <div className="h-full w-full origin-left bg-emerald-400 motion-safe:animate-[fill-feedback-progress_1.8s_linear_forwards] motion-reduce:animate-none" />
            </div>
            <div className="flex items-center gap-3">
              <span
                className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300"
                aria-hidden="true"
              >
                <svg
                  className="size-4"
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-sm">
                  {fillFeedback.filledCount === 1
                    ? "1 field updated"
                    : `${fillFeedback.filledCount} fields updated`}
                </p>
                <p className="text-muted-foreground text-xs">
                  Review the form before submitting.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default defineContentScript({
  matches: ["https://*/*", "http://*/*"],
  registration: "runtime",
  cssInjectionMode: "ui",

  async main(ctx) {
    ensureHandlersRegistered();
    ensurePassiveDetectionStarted();

    if (shouldSkipUiMount()) return;

    const ui = await createShadowRootUi(ctx, {
      name: "form-agent-ui",
      position: "overlay",
      anchor: "body",
      onMount: (container) => {
        const app = document.createElement("div");
        container.append(app);

        const root = ReactDOM.createRoot(app);
        root.render(<ContentScriptUI />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
