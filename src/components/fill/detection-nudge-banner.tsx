import type { CSSProperties } from "react";
import { browser } from "wxt/browser";
import { Button } from "~/components/ui/button";

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
      className="pointer-events-auto fixed inset-x-4 top-6 z-[2147483647] flex justify-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-4 motion-safe:zoom-in-95 motion-safe:duration-300 motion-reduce:animate-none"
      aria-label={title || "Fill My Form"}
      data-testid="form-detection-nudge-banner"
    >
      <div className="relative min-w-64 max-w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-primary/35 bg-background/95 px-4 py-3 text-foreground shadow-2xl shadow-black/25 ring-1 ring-border backdrop-blur">
        <div className="absolute inset-x-0 top-0 h-1 bg-primary/15">
          <div
            key={hint ? "hint" : "nudge"}
            className="h-full w-full origin-left bg-primary/70 motion-safe:animate-[fill-feedback-progress_14s_linear_forwards] motion-reduce:animate-none"
            style={
              {
                animationDuration: `${DETECTION_NUDGE_AUTO_HIDE_MS}ms`,
              } satisfies CSSProperties
            }
          />
        </div>
        <div className="flex flex-col gap-3">
          <div className="min-w-0 pr-6">
            <p className="font-semibold text-sm">
              {title || "Forms ready to review"}
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {hint ? hintBody : body}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!hint && (
              <Button
                type="button"
                size="sm"
                className="h-8"
                onClick={onReview}
              >
                {reviewLabel || "Review"}
              </Button>
            )}
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto px-0 text-muted-foreground text-xs"
              onClick={onDismiss}
            >
              {dismissLabel || "Dismiss"}
            </Button>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-2 right-2 text-muted-foreground"
          aria-label={dismissLabel || "Dismiss"}
          onClick={onDismiss}
        >
          ×
        </Button>
      </div>
    </section>
  );
};
