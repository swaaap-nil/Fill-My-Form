import type { CSSProperties } from "react";
import { browser } from "wxt/browser";

export const DETECTION_NUDGE_AUTO_HIDE_MS = 14_000;

export const DetectionNudgeBanner = ({
  knownFieldCount,
  answerCount,
  hint = false,
  onReview,
  onDismiss,
}: {
  readonly knownFieldCount: number;
  readonly answerCount: number;
  /** Show the "click the toolbar icon" message instead of the Review action. */
  readonly hint?: boolean;
  readonly onReview: () => void;
  readonly onDismiss: () => void;
}) => {
  const title = browser.i18n.getMessage("detectionNudgeBannerTitle");
  const body =
    browser.i18n.getMessage("proactiveDetectionBody", [
      String(knownFieldCount),
      String(answerCount),
    ]) ||
    `${knownFieldCount} known fields, ${answerCount} answers ready to review`;
  const hintBody =
    browser.i18n.getMessage("detectionNudgeBannerOpenHint") ||
    "Click the Fill My Form icon in your browser toolbar to review.";
  const reviewLabel = browser.i18n.getMessage("detectionNudgeBannerAction");
  const dismissLabel = browser.i18n.getMessage("detectionNudgeBannerDismiss");

  return (
    <section
      className="fmf-banner-root fmf-banner-root--interactive"
      aria-label={title || "Fill My Form"}
      data-testid="form-detection-nudge-banner"
    >
      <div className="fmf-banner-card">
        <div className="fmf-progress-track">
          <div
            key={hint ? "hint" : "nudge"}
            className="fmf-progress-fill"
            style={
              {
                animationDuration: `${DETECTION_NUDGE_AUTO_HIDE_MS}ms`,
              } satisfies CSSProperties
            }
          />
        </div>
        <div className="fmf-banner-stack">
          <div className="fmf-banner-copy">
            <p className="fmf-banner-title">
              {title || "Forms ready to review"}
            </p>
            <p className="fmf-banner-message">{hint ? hintBody : body}</p>
          </div>
          <div className="fmf-banner-actions">
            {!hint && (
              <button
                type="button"
                className="fmf-button fmf-button--primary"
                onClick={onReview}
              >
                {reviewLabel || "Review"}
              </button>
            )}
            <button
              type="button"
              className="fmf-button fmf-button--link"
              onClick={onDismiss}
            >
              {dismissLabel || "Dismiss"}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="fmf-button fmf-button--icon"
          aria-label={dismissLabel || "Dismiss"}
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
    </section>
  );
};
