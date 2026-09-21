import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileImage,
  FileText,
  FileUp,
  HelpCircle,
  LoaderCircle,
  PenLine,
  SearchX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Browser } from "wxt/browser";
import { browser } from "wxt/browser";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import type { PreparedArtifact } from "~/core/files/preparation";
import type { UploadIntent } from "~/core/form/types";
import { getActiveBrowserTab } from "~/lib/active-browser-tab";
import {
  ALL_SITES_UPGRADE_FULL_STRIP_MAX_IMPRESSIONS,
  type AllSitesUpgradeState,
  clearAllSitesUpgradeSnooze,
  loadAllSitesUpgradeState,
  persistUpgradeImpression,
  shouldShowAllSitesUpgradeLink,
  shouldShowAllSitesUpgradeStrip,
  snoozeAllSitesUpgrade,
} from "~/lib/all-sites-upgrade-prompt";
import {
  createIndexedDbFileReferenceStore,
  type FileReferenceStore,
} from "~/lib/files/adapters";
import { createBrowserFilePreparationRegistry } from "~/lib/files/preparation-registry";
import type { DecisionId, FieldProposal } from "~/lib/messaging";
import { sendMessage } from "~/lib/messaging";
import {
  consumePendingFillTabId,
  peekPendingFillTabId,
} from "~/lib/pending-fill-tab";
import {
  runAllSitesAccessRequest,
  runScanSiteAccess,
  shouldAutoScanGrantedTab,
} from "~/lib/scan-site-access-flow";
import { useSound } from "~/lib/sfx/react";
import {
  isAllSiteOriginPattern,
  siteAccess,
  toOriginPattern,
} from "~/lib/site-access";
import {
  clearTabFillSnapshot,
  loadTabFillSnapshot,
  panelStateFromSnapshot,
  saveTabFillSnapshot,
  snapshotFromPanelState,
  type TabFillPanelState,
} from "~/lib/tab-fill-snapshot";
import { cn } from "~/lib/utils";
import { PreparationSuccessSupport } from "../files/preparation-success-support";
import { PreparedFileHandoff } from "../files/prepared-file-handoff";
import { useObjectUrl } from "../files/use-object-url";
import { AgentRunPanel } from "./agent-run-panel";
import { KnownFieldsDetails, ProposalCard } from "./proposal-card";

/**
 * Drives one grant-then-fill cycle for the active tab.
 *
 * **Nothing here fills anything before the user looks at it.** `runFill`
 * only proposes; a value reaches the page only via `confirmFill`, one
 * decisionId at a time (or several, for "confirm all"), each of which
 * re-runs policy with `userConfirmed: true` in the background. See
 * `~/core/fill/driver` for why that split exists.
 *
 * **"Scan this page" owns the permission prompt.** If the active tab's own
 * origin is not granted yet, the scan click requests that one-origin grant
 * before trying to read the page. That keeps the privacy boundary deliberate
 * without making the user learn a separate grant-then-scan step. Already
 * granted http(s) tabs with no snapshot auto-scan; Rescan stays a click.
 *
 * **Site access is called directly here, not through a background
 * message.** `chrome.permissions.request()` only succeeds inside the
 * synchronous call stack of a user gesture; a service worker invoked via
 * `sendMessage` from that gesture does not inherit it and the call rejects
 * with "This function must be called during a user gesture". The side
 * panel is itself a privileged extension page with the same `permissions`
 * and `scripting` API access the background has, so it calls
 * `~/lib/site-access` itself. `runFill`/`confirmFill` stay background
 * messages: they need no gesture, and the `MemoryStore` and decision map
 * they use only exist there.
 */

type ScanState =
  | { readonly kind: "idle" }
  | { readonly kind: "not_granted" }
  | {
      readonly kind: "proposals";
      readonly proposals: readonly FieldProposal[];
      readonly uploadIntents: readonly UploadIntent[];
    };

type ProposalView = "summary" | "answers" | "known" | "uploads";
type ProposalViewTransition = "none" | "forward" | "back";

type FillStatus =
  | { readonly kind: "ready" }
  | { readonly kind: "filling"; readonly attemptedCount: number }
  | { readonly kind: "filled"; readonly filledCount: number }
  | {
      readonly kind: "partial";
      readonly attemptedCount: number;
      readonly filledCount: number;
    }
  | { readonly kind: "failed"; readonly attemptedCount: number };

type ScanUiState =
  | "idle"
  | "scanning"
  | "results"
  | "filled"
  | "blocked"
  | "failed";

/**
 * The side panel's own `currentWindow` is unambiguous — it is attached to
 * a specific window — unlike the background service worker, which has no
 * window of its own and cannot reliably resolve "the active tab" the same
 * way. Every action that needs a tab resolves it here, once, and passes
 * the id through explicitly rather than letting the background re-derive
 * (and potentially mis-derive) it.
 */
const getActiveTab = () => getActiveBrowserTab();

const pluralizeAnswer = (count: number) =>
  count === 1 ? "answer detected" : "answers detected";

const pluralizePlainAnswer = (count: number) =>
  count === 1 ? "answer" : "answers";

const pluralizeFilledAnswer = (count: number) =>
  count === 1 ? "answer filled" : "answers filled";

const pluralizeKnownField = (count: number) =>
  count === 1 ? "known field detected" : "known fields detected";

const pluralizeUploadRequirement = (count: number) =>
  count === 1 ? "upload requirement detected" : "upload requirements detected";

const GENERIC_UPLOAD_LABEL =
  /^(attach|upload|browse|choose file|choose|select)(?:\s+file)?\.?$/i;

const uploadConceptName = (intent: UploadIntent): string => {
  const source = [intent.label, intent.description, ...intent.requirements]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  if (intent.kind === "photo") return "photograph";
  if (intent.kind === "signature") return "signature";
  if (intent.kind === "document") {
    if (/\bresume\b|\bcv\b/i.test(source)) return "resume";
    if (/\bcertificate\b/i.test(source)) return "certificate";
    return "document";
  }
  const label = intent.label?.trim();
  if (label && !GENERIC_UPLOAD_LABEL.test(label)) return label;
  return "upload";
};

const uploadConceptArticle = (name: string): "a" | "an" | undefined => {
  if (/\s/.test(name)) return undefined;
  return /^[aeiou]/i.test(name) ? "an" : "a";
};

const uploadRequirementDetail = (
  intent: UploadIntent,
  conceptName: string,
): string | undefined => {
  const detail = intent.description?.trim();
  if (!detail) return undefined;
  if (GENERIC_UPLOAD_LABEL.test(detail)) return undefined;
  if (detail.toLowerCase() === conceptName.toLowerCase()) return undefined;
  return detail;
};

const uploadKindIcon = (kind: UploadIntent["kind"]) => {
  if (kind === "photo") return FileImage;
  if (kind === "signature") return PenLine;
  if (kind === "document") return FileText;
  return HelpCircle;
};

const uploadAcceptHint = (intent: UploadIntent): string => {
  const accept = intent.constraints.find(
    (constraint) => constraint.kind === "accept",
  );
  if (!accept) return "Images or PDF";
  const labels = accept.value.map((value) => {
    if (value === "application/pdf" || value === ".pdf") return "PDF";
    if (value.startsWith(".")) return value.slice(1).toUpperCase();
    if (value.startsWith("image/")) return "Images";
    return value;
  });
  return [...new Set(labels)].join(", ");
};

const findGrantedOriginForUrl = (
  url: string | undefined,
  grantedOrigins: readonly string[],
) => {
  if (!url) return undefined;

  if (grantedOrigins.some(isAllSiteOriginPattern)) {
    return grantedOrigins.find(isAllSiteOriginPattern) ?? "https://*/*";
  }

  try {
    const origin = toOriginPattern(url);
    return grantedOrigins.find((grantedOrigin) => grantedOrigin === origin);
  } catch {
    return undefined;
  }
};

const formatGrantedOrigin = (origin: string) => {
  if (isAllSiteOriginPattern(origin)) {
    return "All websites";
  }
  const bare = origin.replace(/\/\*$/, "");
  try {
    return new URL(bare).host;
  } catch {
    return origin;
  }
};

const ScanEmptyState = () => (
  <div
    className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3 px-3 py-8 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-reduce:animate-none"
    data-testid="scan-no-fields-found"
    role="status"
  >
    <span
      className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm shadow-primary/30"
      aria-hidden="true"
    >
      <SearchX className="size-7" />
    </span>
    <div className="flex max-w-xs flex-col gap-2">
      <h2 className="text-balance font-semibold text-2xl text-foreground leading-tight tracking-tight">
        {browser.i18n.getMessage("scanNoFieldsFound")}
      </h2>
      <p className="text-pretty text-base text-muted-foreground leading-relaxed">
        {browser.i18n.getMessage("scanNoFieldsFoundHint")}
      </p>
    </div>
  </div>
);

const formatScanTimestamp = (scannedAt: Date | undefined) => {
  if (!scannedAt) return "Last scanned";

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - scannedAt.getTime()) / 1000),
  );
  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "always",
    style: "long",
  });

  if (elapsedSeconds < 60) {
    return `Last scanned ${formatter.format(-elapsedSeconds, "second")}`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `Last scanned ${formatter.format(-elapsedMinutes, "minute")}`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `Last scanned ${formatter.format(-elapsedHours, "hour")}`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `Last scanned ${formatter.format(-elapsedDays, "day")}`;
};

const SummaryCardShell = ({
  testId,
  onOpenDetails,
  title,
  subtitle,
  className,
  children,
}: {
  readonly testId: string;
  readonly onOpenDetails: () => void;
  readonly title: string;
  readonly subtitle: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}) => {
  const openDetailsFromHeader = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();
    onOpenDetails();
  };

  return (
    <div
      data-testid={`${testId}-card`}
      className={cn(
        "group/summary-card relative flex cursor-pointer flex-col gap-3 rounded-lg border border-primary/25 bg-card p-3 shadow-sm shadow-black/5 transition-all duration-300 ease-out hover:border-primary/55 hover:bg-accent/25 hover:shadow-md hover:shadow-primary/10 active:translate-y-px active:scale-[0.995] focus-within:border-primary/60 focus-within:ring-3 focus-within:ring-ring/30 motion-reduce:transform-none motion-reduce:transition-none dark:shadow-black/20",
        "motion-safe:hover:-translate-y-0.5",
        className,
      )}
    >
      <button
        type="button"
        className="absolute inset-0 rounded-lg outline-none"
        aria-label={title}
        tabIndex={-1}
        onClick={onOpenDetails}
      />
      <button
        type="button"
        data-testid={testId}
        className="relative z-10 flex w-full cursor-pointer items-start justify-between gap-3 rounded-md text-left outline-none transition-colors hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        onClick={openDetailsFromHeader}
      >
        <div className="min-w-0 rounded-md">
          <p className="font-semibold text-sm">{title}</p>
          <p className="text-muted-foreground text-xs">{subtitle}</p>
        </div>
        <ChevronRight
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-all duration-300 group-hover/summary-card:translate-x-0.5 group-hover/summary-card:text-primary group-focus-within/summary-card:translate-x-0.5 group-focus-within/summary-card:text-primary motion-reduce:transform-none motion-reduce:transition-none"
          aria-hidden="true"
        />
      </button>
      <div className="relative z-10">{children}</div>
    </div>
  );
};

const ScanToolbar = ({
  state,
  grantedOrigin,
  scannedAt,
  onScan,
  onRevoke,
  showAllSitesUpgradeStrip,
  showAllSitesUpgradeLink,
  onEnableAllSites,
  onSnoozeAllSitesUpgrade,
  perSiteAccessOnly,
}: {
  readonly state: ScanUiState;
  readonly grantedOrigin: string | undefined;
  readonly scannedAt: Date | undefined;
  readonly onScan: () => void;
  readonly onRevoke: (origin: string) => void;
  readonly showAllSitesUpgradeStrip: boolean;
  readonly showAllSitesUpgradeLink: boolean;
  readonly onEnableAllSites: () => void;
  readonly onSnoozeAllSitesUpgrade: () => void;
  readonly perSiteAccessOnly: boolean;
}) => {
  const scanning = state === "scanning";
  const hasScanResult = state === "results" || state === "filled";
  const scanLabel =
    state === "scanning"
      ? "Scanning..."
      : state === "results"
        ? "Rescan page"
        : state === "filled"
          ? "Scan again"
          : "Scan this page";
  const statusLabel =
    state === "filled"
      ? "Filled from last scan"
      : formatScanTimestamp(scannedAt);

  return (
    <div className="flex min-h-[5.25rem] flex-col justify-center gap-2 rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/5 transition-all duration-300 ease-out motion-reduce:transition-none dark:shadow-black/20">
      {hasScanResult ? (
        <div className="flex min-w-0 items-center justify-between gap-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:zoom-in-95">
          <span className="min-w-0 truncate px-1 text-muted-foreground text-xs">
            {statusLabel}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="motion-safe:active:scale-[0.99]"
            onClick={onScan}
          >
            {scanLabel}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          disabled={scanning}
          onClick={onScan}
          className={cn(
            "relative w-full overflow-hidden transition-all duration-300 ease-out motion-safe:active:scale-[0.99] motion-reduce:transition-none",
            scanning &&
              "before:absolute before:inset-0 before:-translate-x-full before:animate-[scan-shimmer_1.45s_ease-in-out_infinite] before:bg-linear-to-r before:from-transparent before:via-white/25 before:to-transparent before:content-[''] motion-reduce:before:animate-none",
          )}
        >
          <span className="relative z-10 inline-flex items-center gap-1.5">
            {scanning && <LoaderCircle className="size-4 animate-spin" />}
            {scanLabel}
          </span>
        </Button>
      )}
      {showAllSitesUpgradeStrip && (
        <div
          className="flex flex-col gap-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-reduce:animate-none"
          data-testid="all-sites-upgrade-strip"
        >
          <p className="text-foreground text-xs leading-relaxed">
            {browser.i18n.getMessage("allSitesUpgradeBenefit")}
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {browser.i18n.getMessage("allSitesUpgradeTrust")}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onEnableAllSites}
            >
              {browser.i18n.getMessage("allSitesUpgradeEnable")}
            </Button>
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto px-0 text-muted-foreground text-xs hover:text-primary"
              onClick={onSnoozeAllSitesUpgrade}
            >
              {browser.i18n.getMessage("allSitesUpgradeNotNow")}
            </Button>
          </div>
        </div>
      )}
      {showAllSitesUpgradeLink && (
        <div
          className="px-1 text-muted-foreground text-xs"
          data-testid="all-sites-upgrade-link"
        >
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto px-0 text-xs"
            onClick={onEnableAllSites}
          >
            {browser.i18n.getMessage("allSitesUpgradeEnable")}
          </Button>
        </div>
      )}
      {grantedOrigin && (
        <div className="flex min-w-0 items-center justify-between gap-2 px-1 text-muted-foreground text-xs transition-all duration-300 ease-out motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-reduce:transition-none">
          <span className="min-w-0 truncate">
            {perSiteAccessOnly ? (
              <>
                {browser.i18n.getMessage("accessThisSiteOnly")}{" "}
                <span className="text-foreground">
                  {formatGrantedOrigin(grantedOrigin)}
                </span>
              </>
            ) : (
              <>
                {browser.i18n.getMessage("accessOnFor")}{" "}
                <span className="text-foreground">
                  {formatGrantedOrigin(grantedOrigin)}
                </span>
              </>
            )}
          </span>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto px-0 text-muted-foreground text-xs hover:text-primary"
            onClick={() => onRevoke(grantedOrigin)}
          >
            Turn off
          </Button>
        </div>
      )}
    </div>
  );
};

const AnswersSummaryCard = ({
  count,
  fillStatus,
  onOpenDetails,
  onFill,
  children,
}: {
  readonly count: number;
  readonly fillStatus: FillStatus;
  readonly onOpenDetails: () => void;
  readonly onFill: () => void;
  readonly children?: React.ReactNode;
}) => {
  const filling = fillStatus.kind === "filling";
  const filled = fillStatus.kind === "filled";
  const partial = fillStatus.kind === "partial";
  const failed = fillStatus.kind === "failed";
  const disabled = filling || count === 0;
  const title =
    fillStatus.kind === "filling"
      ? `Filling ${fillStatus.attemptedCount} ${pluralizePlainAnswer(
          fillStatus.attemptedCount,
        )}...`
      : filled
        ? `${fillStatus.filledCount} ${pluralizeFilledAnswer(
            fillStatus.filledCount,
          )}`
        : partial
          ? `${fillStatus.filledCount} of ${fillStatus.attemptedCount} answers filled`
          : failed
            ? "Could not fill answers"
            : `${count} ${pluralizeAnswer(count)}`;
  const subtitle = filled
    ? "All detected answers were applied to the form."
    : partial
      ? "Some answers were applied. Open details to review what remains."
      : failed
        ? "Nothing was changed. Try again or open details to review."
        : "Review detected answers before filling.";

  return (
    <SummaryCardShell
      testId="answers-summary"
      onOpenDetails={onOpenDetails}
      title={title}
      subtitle={subtitle}
      className={cn(
        filling && "scale-[0.995] border-primary/45 shadow-primary/10",
        filled &&
          "border-emerald-500/55 bg-emerald-50/70 shadow-emerald-500/15 dark:bg-emerald-950/20",
        partial &&
          "border-amber-500/55 bg-amber-50/70 shadow-amber-500/15 dark:bg-amber-950/20",
        failed &&
          "border-destructive/55 bg-destructive/5 shadow-destructive/10",
      )}
    >
      {filled ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-500/25 bg-white/70 px-2.5 py-2 shadow-xs motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 dark:bg-emerald-950/25">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 motion-safe:animate-in motion-safe:zoom-in-50"
              aria-hidden="true"
            >
              <CheckCircle2 className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-emerald-950 text-xs dark:text-emerald-100">
                Applied to form
              </p>
              <p className="truncate text-[11px] text-emerald-800/75 dark:text-emerald-100/70">
                Ready for a quick review.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="border-emerald-500/35 bg-white/80 text-emerald-950 hover:bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-100 dark:hover:bg-emerald-900/30"
            onClick={onOpenDetails}
          >
            Review
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {(filling || partial || failed) && (
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full transition-transform duration-300 motion-reduce:transition-none",
                filling && "bg-primary/20 text-primary-foreground",
                partial && "bg-amber-500 text-white",
                failed && "bg-destructive text-destructive-foreground",
              )}
              aria-hidden="true"
            >
              {filling && <LoaderCircle className="size-4 animate-spin" />}
              {partial && <AlertTriangle className="size-4" />}
              {failed && <AlertTriangle className="size-4" />}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={onFill}
            className="flex-1 motion-safe:active:scale-[0.99]"
          >
            {filling ? "Filling..." : "Fill My Form 😡"}
          </Button>
          {children}
        </div>
      )}
    </SummaryCardShell>
  );
};

const KnownFieldsSummaryCard = ({
  count,
  onOpenDetails,
  tabId,
  scanVersion,
}: {
  readonly count: number;
  readonly onOpenDetails: () => void;
  readonly tabId: number | undefined;
  readonly scanVersion: number;
}) => (
  <SummaryCardShell
    testId="known-fields-summary"
    onOpenDetails={onOpenDetails}
    title={`${count} ${pluralizeKnownField(count)}`}
    subtitle="Answer missing information for detected fields."
  >
    <AgentRunPanel key={scanVersion} tabId={tabId} />
  </SummaryCardShell>
);

const UploadRequirementsSummaryCard = ({
  count,
  onOpenDetails,
}: {
  readonly count: number;
  readonly onOpenDetails: () => void;
}) => (
  <SummaryCardShell
    testId="upload-requirements-summary"
    onOpenDetails={onOpenDetails}
    title={`${count} ${pluralizeUploadRequirement(count)}`}
    subtitle="Original files stay unchanged. Prepared copies expire automatically."
  >
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={(event) => {
        event.stopPropagation();
        onOpenDetails();
      }}
    >
      Upload Files and forget about them
    </Button>
  </SummaryCardShell>
);

const UploadIntentItem = ({
  intent,
  onPrepare,
  output,
  error,
}: {
  readonly intent: UploadIntent;
  readonly onPrepare: (file: File) => Promise<void>;
  readonly output?: {
    readonly artifact: PreparedArtifact;
    readonly store: FileReferenceStore;
    readonly name: string;
    readonly size: number;
    readonly mimeType: string;
  };
  readonly error?: string;
}) => {
  const fileInputId = useId();
  const [sourceFile, setSourceFile] = useState<File>();
  const [dragActive, setDragActive] = useState(false);
  const sourceUrl = useObjectUrl(sourceFile);
  const accept =
    intent.constraints
      .find((constraint) => constraint.kind === "accept")
      ?.value.join(",") ?? "image/*,application/pdf";
  const conceptName = uploadConceptName(intent);
  const conceptArticle = uploadConceptArticle(conceptName);
  const requirementDetail = uploadRequirementDetail(intent, conceptName);
  const KindIcon = uploadKindIcon(intent.kind);
  const chooseLabel = intent.label ?? conceptName;

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setSourceFile(file);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-card p-3 shadow-sm shadow-black/5 dark:shadow-black/20">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          <KindIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            We know this is
            {conceptArticle ? ` ${conceptArticle}` : ""}{" "}
            <span className="font-medium">{conceptName}</span>, but you haven't
            prepared a copy for it yet — choose a file below.
          </p>
          {requirementDetail && (
            <p className="mt-1 text-muted-foreground text-xs">
              {requirementDetail}
            </p>
          )}
        </div>
      </div>
      {sourceFile ? (
        <>
          {sourceUrl && sourceFile.type.startsWith("image/") ? (
            <div className="h-48 overflow-hidden rounded-lg border bg-muted">
              <img
                src={sourceUrl}
                alt="Selected upload preview"
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/30 p-4 text-center text-muted-foreground text-xs">
              Document selected. Prepare a temporary upload copy locally.
            </div>
          )}
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-xs">
            <span className="min-w-0 truncate">
              {sourceFile.name} · {Math.round(sourceFile.size / 1024)} KB
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              onClick={() => setSourceFile(undefined)}
              aria-label="Remove selected file"
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void onPrepare(sourceFile)}
          >
            Prepare file
          </Button>
        </>
      ) : (
        <>
          <label
            htmlFor={fileInputId}
            className={cn(
              "flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 text-center transition-colors hover:border-primary/60 hover:bg-accent/35",
              dragActive && "border-primary/70 bg-accent/45",
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
              chooseFile(event.dataTransfer.files[0]);
            }}
          >
            <FileUp className="size-5 text-muted-foreground" />
            <span className="font-medium text-sm">
              Browse or drag a file here
            </span>
            <span className="text-muted-foreground text-xs">
              {uploadAcceptHint(intent)}
            </span>
          </label>
          <input
            id={fileInputId}
            className="sr-only"
            type="file"
            accept={accept}
            aria-label={`Choose ${chooseLabel}`}
            onChange={(event) => {
              chooseFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </>
      )}
      {output && (
        <>
          <PreparedFileHandoff
            artifact={output.artifact}
            store={output.store}
            label={chooseLabel}
          />
          {output.artifact.mimeType.startsWith("image/") ? (
            <PreparationSuccessSupport />
          ) : null}
        </>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
};

const UploadIntentsCard = ({
  intents,
}: {
  readonly intents: readonly UploadIntent[];
}) => {
  const [prepared, setPrepared] = useState<
    Record<
      string,
      {
        readonly artifact: PreparedArtifact;
        readonly store: FileReferenceStore;
        readonly name: string;
        readonly size: number;
        readonly mimeType: string;
        readonly cleanupIds: readonly string[];
      }
    >
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const preparedRef = useRef(prepared);

  useEffect(() => {
    preparedRef.current = prepared;
  }, [prepared]);

  useEffect(
    () => () => {
      for (const output of Object.values(preparedRef.current)) {
        void Promise.all(
          output.cleanupIds.map((id) => output.store.delete(id)),
        );
      }
    },
    [],
  );

  const prepare = async (intent: UploadIntent, file: File) => {
    setErrors((current) => ({ ...current, [intent.id]: "" }));
    let originalId: string | undefined;
    let storeForCleanup: FileReferenceStore | undefined;
    try {
      const store = await createIndexedDbFileReferenceStore();
      storeForCleanup = store;
      const original = await store.save(file);
      originalId = original.id;
      const registry = createBrowserFilePreparationRegistry(store);
      const adapter = registry.adapterFor({
        kind:
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf")
            ? "pdf"
            : "image",
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!adapter) {
        await store.delete(original.id);
        originalId = undefined;
        setErrors((current) => ({
          ...current,
          [intent.id]: "This file type is not supported by a local adapter.",
        }));
        return;
      }
      const output = await adapter.prepareForConstraints(
        original,
        intent.constraints,
      );
      await store.delete(original.id);
      originalId = undefined;
      if (!output.ok) {
        setErrors((current) => ({
          ...current,
          [intent.id]: output.reason,
        }));
        return;
      }
      setPrepared((current) => {
        const previous = current[intent.id];
        if (previous) {
          void Promise.all(
            previous.cleanupIds.map((id) => previous.store.delete(id)),
          );
        }
        return {
          ...current,
          [intent.id]: {
            artifact: output.artifact,
            store,
            name: output.artifact.name,
            size: output.artifact.sizeBytes,
            mimeType: output.artifact.mimeType,
            cleanupIds: [output.artifact.derived.id],
          },
        };
      });
    } catch {
      if (storeForCleanup && originalId)
        void storeForCleanup.delete(originalId);
      setErrors((current) => ({
        ...current,
        [intent.id]: "Local preparation failed.",
      }));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {intents.map((intent) => (
        <UploadIntentItem
          key={intent.id}
          intent={intent}
          output={prepared[intent.id]}
          error={errors[intent.id]}
          onPrepare={(file) => prepare(intent, file)}
        />
      ))}
    </div>
  );
};

export const FillPanel = () => {
  const sound = useSound();
  const [scanState, setScanState] = useState<ScanState>({ kind: "idle" });
  const [proposalView, setProposalView] = useState<ProposalView>("summary");
  const [proposalViewTransition, setProposalViewTransition] =
    useState<ProposalViewTransition>("none");
  const [knownFieldsRemembered, setKnownFieldsRemembered] = useState(false);
  const [scanVersion, setScanVersion] = useState(0);
  const [confirmedIds, setConfirmedIds] = useState<Set<DecisionId>>(new Set());
  const [fillStatus, setFillStatus] = useState<FillStatus>({ kind: "ready" });
  const [scanUiState, setScanUiState] = useState<ScanUiState>("idle");
  const [scanAccessHint, setScanAccessHint] = useState<string | undefined>();
  const [lastScannedAt, setLastScannedAt] = useState<Date>();
  const [, setClockTick] = useState(0);
  const [grantedOrigins, setGrantedOrigins] = useState<readonly string[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | undefined>();
  // Cached alongside `activeTabId` so `scan` can call
  // `permissions.request()` with no `await` ahead of it in the click
  // handler — see the comment there for why that matters in Firefox. Kept
  // fresh continuously (see the `tabs.onActivated`/`onUpdated` listeners
  // below) rather than only at mount, grant, or revoke — the panel can
  // stay open across a tab switch, and a stale cache would then send
  // `requestSiteAccess` at whatever tab happened to be active when the
  // panel last refreshed, not the one the user is actually looking at.
  const [activeTabUrl, setActiveTabUrl] = useState<string | undefined>();
  // Whether the *currently active tab's* origin has been granted — not
  // just whether the user has granted access to *some* site. "Scan this
  // page" only ever means the active tab, so scan asks for that specific
  // origin when needed rather than assuming any granted origin is enough.
  const [activeTabGranted, setActiveTabGranted] = useState(false);
  const [hasAllSiteAccess, setHasAllSiteAccess] = useState(false);
  const [allSitesUpgradeState, setAllSitesUpgradeState] =
    useState<AllSitesUpgradeState>({
      snoozedUntilIso: null,
      impressionCount: 0,
    });
  const upgradeStripImpressionRecordedRef = useRef(false);
  const [fullStripPinnedForSession, setFullStripPinnedForSession] =
    useState(false);
  const [allSitesEnableError, setAllSitesEnableError] = useState<
    string | undefined
  >();

  const applyActiveTab = useCallback(
    async (tab: Browser.tabs.Tab | undefined) => {
      setActiveTabId(tab?.id);
      setActiveTabUrl(tab?.url);
      setActiveTabGranted(
        tab?.url ? await siteAccess.hasSiteAccess(tab.url) : false,
      );
    },
    [],
  );

  const refreshAccessState = useCallback(async () => {
    setGrantedOrigins(await siteAccess.listGrantedOrigins());
    setHasAllSiteAccess(await siteAccess.hasAllSiteAccess());
    await applyActiveTab(await getActiveTab());
  }, [applyActiveTab]);

  useEffect(() => {
    void loadAllSitesUpgradeState().then(setAllSitesUpgradeState);
    refreshAccessState();

    const handleActivated = ({ tabId }: { tabId: number }) => {
      browser.tabs.get(tabId).then(applyActiveTab);
    };
    const handleUpdated = (
      _tabId: number,
      _changeInfo: unknown,
      tab: Browser.tabs.Tab,
    ) => {
      // Covers a same-tab navigation (no `onActivated` fires for that) —
      // ignore updates to a tab that isn't the active one.
      if (tab.active) applyActiveTab(tab);
    };
    browser.tabs.onActivated.addListener(handleActivated);
    browser.tabs.onUpdated.addListener(handleUpdated);
    const refreshOnPermissionChange = () => {
      void refreshAccessState();
    };
    browser.permissions.onAdded?.addListener(refreshOnPermissionChange);
    browser.permissions.onRemoved?.addListener(refreshOnPermissionChange);
    return () => {
      browser.tabs.onActivated.removeListener(handleActivated);
      browser.tabs.onUpdated.removeListener(handleUpdated);
      browser.permissions.onAdded?.removeListener?.(refreshOnPermissionChange);
      browser.permissions.onRemoved?.removeListener?.(
        refreshOnPermissionChange,
      );
    };
  }, [refreshAccessState, applyActiveTab]);

  const scanGrantedRef = useRef<() => Promise<void>>(async () => {});

  const resetPanelForTabWithoutSnapshot = useCallback(() => {
    setScanState({ kind: "idle" });
    setScanUiState("idle");
    setLastScannedAt(undefined);
    setFillStatus({ kind: "ready" });
    setProposalView("summary");
    setProposalViewTransition("none");
    setConfirmedIds(new Set());
    setScanAccessHint(undefined);
  }, []);

  const hydrateFromTabSnapshot = useCallback((panel: TabFillPanelState) => {
    setScanState(panel.scanState);
    setScanUiState(panel.scanUiState);
    setFillStatus(panel.fillStatus);
    setLastScannedAt(panel.lastScannedAt);
    setConfirmedIds(new Set(panel.confirmedIds));
    setScanVersion(panel.scanVersion);
    setProposalView("summary");
    setProposalViewTransition("none");
    setScanAccessHint(undefined);
  }, []);

  useEffect(() => {
    if (activeTabId === undefined) return;
    void (async () => {
      const pending = await peekPendingFillTabId();
      const isPendingTarget = pending === activeTabId;
      const snapshot = await loadTabFillSnapshot(activeTabId, {
        currentUrl: activeTabUrl,
      });

      if (isPendingTarget) {
        await consumePendingFillTabId();
        if (snapshot) {
          hydrateFromTabSnapshot(panelStateFromSnapshot(snapshot));
          return;
        }
        // Nudge / notification: access already exists; do not call request().
        await scanGrantedRef.current();
        return;
      }

      if (snapshot) {
        hydrateFromTabSnapshot(panelStateFromSnapshot(snapshot));
        return;
      }

      resetPanelForTabWithoutSnapshot();
      const hasAccess = activeTabUrl
        ? await siteAccess.hasSiteAccess(activeTabUrl)
        : false;
      if (
        shouldAutoScanGrantedTab({
          url: activeTabUrl,
          hasAccess,
          hasSnapshot: false,
        })
      ) {
        await scanGrantedRef.current();
      }
    })();
  }, [
    activeTabId,
    activeTabUrl,
    hydrateFromTabSnapshot,
    resetPanelForTabWithoutSnapshot,
  ]);

  useEffect(() => {
    if (!lastScannedAt) return undefined;

    const interval = window.setInterval(() => {
      setClockTick((tick) => tick + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [lastScannedAt]);

  const scanGrantedTab = async () => {
    if (activeTabId === undefined || activeTabUrl === undefined) {
      sound.stopLoop("scan-page");
      return;
    }

    setScanUiState("scanning");
    setScanAccessHint(undefined);
    setFillStatus({ kind: "ready" });
    sound.startLoop("scan-page", "scanStarted");

    try {
      await siteAccess.syncScriptsForGrantedAccess(activeTabUrl, activeTabId);
      await refreshAccessState();

      let fillResult = await sendMessage("runFill", { tabId: activeTabId });
      if (!fillResult.granted) {
        await siteAccess.syncScriptsForGrantedAccess(activeTabUrl, activeTabId);
        fillResult = await sendMessage("runFill", { tabId: activeTabId });
        if (!fillResult.granted) {
          setActiveTabGranted(false);
          setScanAccessHint(
            "Access looks granted but this page still cannot be read. Reload the tab, then scan again.",
          );
          setScanState({ kind: "not_granted" });
          setScanUiState("blocked");
          sound.stopLoop("scan-page");
          sound.play("scanBlocked");
          return;
        }
      }
      setConfirmedIds(new Set());
      setProposalView("summary");
      setProposalViewTransition("none");
      const scannedAt = new Date();
      const nextScanVersion = scanVersion + 1;
      setScanVersion(nextScanVersion);
      setScanState({
        kind: "proposals",
        proposals: fillResult.proposals,
        uploadIntents: fillResult.uploadIntents,
      });
      setLastScannedAt(scannedAt);
      setScanUiState("results");
      await saveTabFillSnapshot(
        snapshotFromPanelState({
          tabId: activeTabId,
          scanState: {
            kind: "proposals",
            proposals: fillResult.proposals,
            uploadIntents: fillResult.uploadIntents,
          },
          scanUiState: "results",
          fillStatus: { kind: "ready" },
          lastScannedAt: scannedAt,
          confirmedIds: new Set(),
          scanVersion: nextScanVersion,
          pageUrl: activeTabUrl,
        }),
      );
      sound.stopLoop("scan-page");
      sound.play("scanSucceeded");
    } catch {
      // No content script reachable in this tab. Leave Scan available.
      setActiveTabGranted(false);
      setScanState({ kind: "not_granted" });
      setScanUiState("failed");
      sound.stopLoop("scan-page");
      sound.play("scanFailed");
    }
  };

  const scan = async () => {
    setScanUiState("scanning");
    setScanAccessHint(undefined);
    setFillStatus({ kind: "ready" });
    sound.startLoop("scan-page", "scanStarted");
    // `permissions.request` must be the first await from this click.
    // Firefox drops the user-gesture flag after contains()/tabs.query().
    // Cached tab URL/id keep this handler from awaiting tabs.query first.
    const access = await runScanSiteAccess({
      url: activeTabUrl,
      tabId: activeTabId,
      requestSiteAccess: (url, tabId) =>
        siteAccess.requestSiteAccess(url, tabId),
    });

    if (access.kind === "no_tab") {
      setScanAccessHint(
        "No active tab was found. Focus a browser tab with a form, then scan again.",
      );
      setScanState({ kind: "not_granted" });
      setScanUiState("blocked");
      sound.stopLoop("scan-page");
      sound.play("scanBlocked");
      return;
    }

    if (access.kind === "not_permissible") {
      setScanAccessHint(
        "This tab cannot be scanned (internal browser pages). Open an http or https page, then scan again.",
      );
      setScanState({ kind: "not_granted" });
      setScanUiState("blocked");
      sound.stopLoop("scan-page");
      sound.play("scanBlocked");
      return;
    }

    if (access.kind === "request_threw") {
      setScanAccessHint(
        "Could not request access from this click. Try Scan again; if no prompt appears, check site access in the browser’s extension settings.",
      );
      setScanState({ kind: "not_granted" });
      setScanUiState("blocked");
      sound.stopLoop("scan-page");
      sound.play("scanBlocked");
      return;
    }

    if (access.kind === "denied") {
      setScanAccessHint(
        "Permission was not granted. If no prompt appeared, check the extension’s site access in chrome://extensions (or use Allow on all sites from the first-run screen).",
      );
      setScanState({ kind: "not_granted" });
      setScanUiState("blocked");
      sound.stopLoop("scan-page");
      sound.play("scanBlocked");
      return;
    }

    await scanGrantedTab();
  };

  scanGrantedRef.current = scanGrantedTab;

  const revoke = async (origin: string) => {
    try {
      await siteAccess.revokeSiteAccess(origin);
      // Revoking the active tab's own origin must clear stale proposals
      // immediately, not just drop it from the granted-origins list.
      setScanState({ kind: "idle" });
      setFillStatus({ kind: "ready" });
      setScanUiState("idle");
      setLastScannedAt(undefined);
      if (activeTabId !== undefined) {
        await sendMessage("siteAccessRevoked", { tabId: activeTabId });
        await clearTabFillSnapshot(activeTabId);
      }
      await refreshAccessState();
      sound.play("accessRevoked");
    } catch {
      sound.play("scanFailed");
    }
  };

  const confirm = async (decisionIds: readonly DecisionId[]) => {
    if (activeTabId === undefined || decisionIds.length === 0) {
      sound.play("fillFailed");
      return;
    }
    setFillStatus({ kind: "filling", attemptedCount: decisionIds.length });
    sound.startLoop("confirm-fill", "fillStarted");
    let outcome: "fillSucceeded" | "fillFailed" = "fillFailed";
    let nextConfirmedIds = confirmedIds;
    let nextFillStatus: FillStatus = { kind: "ready" };
    let nextScanUiState: ScanUiState = scanUiState;
    try {
      const { results } = await sendMessage("confirmFill", {
        decisionIds,
        tabId: activeTabId,
      });
      const ok = new Set(results.filter((r) => r.ok).map((r) => r.decisionId));
      nextConfirmedIds = new Set([...confirmedIds, ...ok]);
      setConfirmedIds(nextConfirmedIds);
      if (ok.size === decisionIds.length) {
        nextFillStatus = { kind: "filled", filledCount: ok.size };
        nextScanUiState = "filled";
        setFillStatus(nextFillStatus);
        setScanUiState(nextScanUiState);
        outcome = "fillSucceeded";
      } else if (ok.size > 0) {
        nextFillStatus = {
          kind: "partial",
          attemptedCount: decisionIds.length,
          filledCount: ok.size,
        };
        setFillStatus(nextFillStatus);
      } else {
        nextFillStatus = {
          kind: "failed",
          attemptedCount: decisionIds.length,
        };
        setFillStatus(nextFillStatus);
      }
    } catch {
      nextFillStatus = { kind: "failed", attemptedCount: decisionIds.length };
      setFillStatus(nextFillStatus);
      outcome = "fillFailed";
    } finally {
      sound.stopLoop("confirm-fill");
    }
    if (scanState.kind === "proposals") {
      await saveTabFillSnapshot(
        snapshotFromPanelState({
          tabId: activeTabId,
          scanState: scanState,
          scanUiState: nextScanUiState,
          fillStatus: nextFillStatus,
          lastScannedAt,
          confirmedIds: nextConfirmedIds,
          scanVersion,
          pageUrl: activeTabUrl,
        }),
      );
    }
    sound.play(outcome);
  };

  const answerDetailProposals: FieldProposal[] =
    scanState.kind === "proposals"
      ? scanState.proposals.filter(
          (p) =>
            p.state === "pending" ||
            p.state === "restricted" ||
            p.state === "choose_option",
        )
      : [];

  const pendingAnswerProposals: FieldProposal[] =
    scanState.kind === "proposals"
      ? scanState.proposals.filter(
          (p) =>
            (p.state === "pending" || p.state === "restricted") &&
            !confirmedIds.has(p.decisionId),
        )
      : [];

  const knownNoAnswerProposals: FieldProposal[] =
    scanState.kind === "proposals"
      ? scanState.proposals.filter(
          (p) => p.state === "no_value" || p.state === "ambiguous",
        )
      : [];

  const answeredDecisionIds: DecisionId[] = pendingAnswerProposals.flatMap(
    (p) =>
      p.state === "pending" || p.state === "restricted" ? [p.decisionId] : [],
  );

  const detailsProposals: readonly FieldProposal[] =
    proposalView === "answers"
      ? answerDetailProposals
      : proposalView === "known"
        ? knownNoAnswerProposals
        : [];
  const proposalViewMotionClass =
    proposalViewTransition === "forward"
      ? "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-200 motion-safe:ease-out"
      : proposalViewTransition === "back"
        ? "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-4 motion-safe:duration-200 motion-safe:ease-out"
        : "";

  const showProposalDetails =
    scanState.kind === "proposals" &&
    (proposalView === "answers" ||
      proposalView === "known" ||
      proposalView === "uploads");
  const showAnswersSummary =
    answerDetailProposals.length > 0 || fillStatus.kind !== "ready";
  const scanLiterallyEmpty =
    scanState.kind === "proposals" &&
    scanState.proposals.length === 0 &&
    scanState.uploadIntents.length === 0;
  const activeGrantedOrigin = activeTabGranted
    ? findGrantedOriginForUrl(activeTabUrl, grantedOrigins)
    : undefined;

  const hasSuccessfulScan =
    scanUiState === "results" || scanUiState === "filled";
  const nowIso = new Date().toISOString();
  const showAllSitesUpgradeStripBase = shouldShowAllSitesUpgradeStrip(
    allSitesUpgradeState,
    nowIso,
    hasAllSiteAccess,
    hasSuccessfulScan,
  );
  const showAllSitesUpgradeStrip =
    showAllSitesUpgradeStripBase || fullStripPinnedForSession;
  const showAllSitesUpgradeLink =
    shouldShowAllSitesUpgradeLink(
      allSitesUpgradeState,
      nowIso,
      hasAllSiteAccess,
      hasSuccessfulScan,
    ) && !showAllSitesUpgradeStrip;
  const perSiteAccessOnly =
    Boolean(activeGrantedOrigin) &&
    !hasAllSiteAccess &&
    !isAllSiteOriginPattern(activeGrantedOrigin ?? "");

  useEffect(() => {
    if (!showAllSitesUpgradeStripBase) {
      upgradeStripImpressionRecordedRef.current = false;
      setFullStripPinnedForSession(false);
      return;
    }
    if (upgradeStripImpressionRecordedRef.current) return;
    upgradeStripImpressionRecordedRef.current = true;
    void persistUpgradeImpression().then((next) => {
      setAllSitesUpgradeState(next);
      if (
        next.impressionCount >= ALL_SITES_UPGRADE_FULL_STRIP_MAX_IMPRESSIONS
      ) {
        setFullStripPinnedForSession(true);
      }
    });
  }, [showAllSitesUpgradeStripBase]);

  const enableAllSitesAccess = async () => {
    setAllSitesEnableError(undefined);
    if (activeTabId === undefined) {
      setAllSitesEnableError(
        "No active tab was found. Focus a browser tab, then try again.",
      );
      return;
    }
    const outcome = await runAllSitesAccessRequest({
      requestAllSiteAccess: (tabId) => siteAccess.requestAllSiteAccess(tabId),
      tabId: activeTabId,
    });
    if (outcome.kind === "failed") {
      setAllSitesEnableError(
        "Could not request access from this click. Try again when the browser prompt can appear.",
      );
      return;
    }
    if (!outcome.granted) {
      setAllSitesEnableError(
        "Permission was not granted. Try again when the browser prompt appears.",
      );
      return;
    }
    if (activeTabUrl) {
      await siteAccess.syncScriptsForGrantedAccess(activeTabUrl, activeTabId);
    }
    await clearAllSitesUpgradeSnooze();
    setAllSitesUpgradeState(await loadAllSitesUpgradeState());
    await refreshAccessState();
  };

  const snoozeAllSitesUpgradePrompt = async () => {
    setFullStripPinnedForSession(false);
    setAllSitesUpgradeState(await snoozeAllSitesUpgrade());
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {scanState.kind === "not_granted" && (
          <p className="text-muted-foreground text-sm">
            {scanAccessHint ??
              'This site needs access before it can be scanned. Use "Scan this page" and approve the browser prompt to continue.'}
          </p>
        )}

        {scanState.kind === "proposals" && showProposalDetails ? (
          <div
            className={cn(
              "flex flex-col gap-2 motion-reduce:animate-none",
              proposalViewMotionClass,
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => {
                if (proposalView === "known" && knownFieldsRemembered) {
                  sound.play("proposalDetailsClosed");
                  void scanGrantedTab();
                  return;
                }
                setProposalViewTransition("back");
                setProposalView("summary");
                sound.play("proposalDetailsClosed");
              }}
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>
            {proposalView === "uploads" ? (
              <UploadIntentsCard intents={scanState.uploadIntents} />
            ) : proposalView === "known" ? (
              <KnownFieldsDetails
                proposals={detailsProposals}
                onConfirm={(decisionId) => confirm([decisionId])}
                confirmedIds={confirmedIds}
                onRememberedChange={setKnownFieldsRemembered}
              />
            ) : (
              detailsProposals.map((proposal) => (
                <ProposalCard
                  key={proposal.fieldId}
                  proposal={proposal}
                  onConfirm={(decisionId) => confirm([decisionId])}
                  confirmedIds={confirmedIds}
                />
              ))
            )}
          </div>
        ) : (
          scanState.kind === "proposals" && (
            <div
              className={cn(
                "flex flex-col gap-4 motion-reduce:animate-none",
                proposalViewMotionClass,
                scanLiterallyEmpty && "min-h-0 flex-1",
              )}
            >
              {showAnswersSummary && (
                <AnswersSummaryCard
                  count={answeredDecisionIds.length}
                  fillStatus={fillStatus}
                  onOpenDetails={() => {
                    setProposalViewTransition("forward");
                    setProposalView("answers");
                    sound.play("proposalDetailsOpened");
                  }}
                  onFill={() => confirm(answeredDecisionIds)}
                >
                  {knownNoAnswerProposals.length === 0 && (
                    <AgentRunPanel key={scanVersion} tabId={activeTabId} />
                  )}
                </AnswersSummaryCard>
              )}
              {knownNoAnswerProposals.length > 0 && (
                <KnownFieldsSummaryCard
                  count={knownNoAnswerProposals.length}
                  onOpenDetails={() => {
                    setKnownFieldsRemembered(false);
                    setProposalViewTransition("forward");
                    setProposalView("known");
                    sound.play("proposalDetailsOpened");
                  }}
                  tabId={activeTabId}
                  scanVersion={scanVersion}
                />
              )}
              {!showAnswersSummary &&
                knownNoAnswerProposals.length === 0 &&
                (scanLiterallyEmpty ? (
                  <ScanEmptyState />
                ) : (
                  <AgentRunPanel key={scanVersion} tabId={activeTabId} />
                ))}
              {scanState.uploadIntents.length > 0 && (
                <UploadRequirementsSummaryCard
                  count={scanState.uploadIntents.length}
                  onOpenDetails={() => {
                    setProposalViewTransition("forward");
                    setProposalView("uploads");
                    sound.play("proposalDetailsOpened");
                  }}
                />
              )}
            </div>
          )
        )}
      </div>

      <div className="mt-auto flex flex-col gap-4">
        <Separator />

        {allSitesEnableError && (
          <p className="text-destructive text-sm" role="alert">
            {allSitesEnableError}
          </p>
        )}

        <ScanToolbar
          state={scanUiState}
          grantedOrigin={activeGrantedOrigin}
          scannedAt={lastScannedAt}
          onScan={scan}
          onRevoke={revoke}
          showAllSitesUpgradeStrip={showAllSitesUpgradeStrip}
          showAllSitesUpgradeLink={showAllSitesUpgradeLink}
          onEnableAllSites={() => void enableAllSitesAccess()}
          onSnoozeAllSitesUpgrade={() => void snoozeAllSitesUpgradePrompt()}
          perSiteAccessOnly={perSiteAccessOnly}
        />
      </div>
    </div>
  );
};
