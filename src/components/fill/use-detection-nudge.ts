import { useCallback, useEffect, useRef, useState } from "react";
import { DETECTION_NUDGE_AUTO_HIDE_MS } from "~/components/fill/detection-nudge-banner";

export const detectionNudgeEvent = "form-agent-detection-nudge";

export interface DetectionNudgeDetail {
  readonly knownFieldCount: number;
  readonly answerCount: number;
}

/**
 * Show/hide state for the in-page detection banner: a `detectionNudgeEvent`
 * shows it (restarting the auto-hide timer), `dismiss` or the timer hides it.
 * `showOpenHint` keeps it up, in its "click the toolbar icon" form, for when
 * the extension UI could not be opened programmatically.
 */
export const useDetectionNudge = () => {
  const [nudge, setNudge] = useState<DetectionNudgeDetail | null>(null);
  const [hint, setHint] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current);
    hideTimer.current = undefined;
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    hideTimer.current = window.setTimeout(() => {
      setNudge(null);
      setHint(false);
    }, DETECTION_NUDGE_AUTO_HIDE_MS);
  }, [clearTimer]);

  useEffect(() => {
    const handleDetectionNudge = (event: Event) => {
      const detail = (event as CustomEvent<DetectionNudgeDetail>).detail;
      setNudge(detail);
      setHint(false);
      startTimer();
    };

    window.addEventListener(detectionNudgeEvent, handleDetectionNudge);
    return () => {
      clearTimer();
      window.removeEventListener(detectionNudgeEvent, handleDetectionNudge);
    };
  }, [startTimer, clearTimer]);

  const dismiss = useCallback(() => {
    clearTimer();
    setNudge(null);
    setHint(false);
  }, [clearTimer]);

  const showOpenHint = useCallback(() => {
    setHint(true);
    startTimer();
  }, [startTimer]);

  return { nudge, hint, dismiss, showOpenHint };
};
