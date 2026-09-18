import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Browser } from "wxt/browser";
import { browser } from "wxt/browser";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import type { PreparedArtifact } from "~/core/files/preparation";
import type { UploadIntent } from "~/core/form/types";
import {
  createIndexedDbFileReferenceStore,
  type FileReferenceStore,
} from "~/lib/files/adapters";
import { createBrowserFilePreparationRegistry } from "~/lib/files/preparation-registry";
import type { DecisionId, FieldProposal } from "~/lib/messaging";
import { sendMessage } from "~/lib/messaging";
import { useSound } from "~/lib/sfx/react";
import { siteAccess, toOriginPattern } from "~/lib/site-access";
import { cn } from "~/lib/utils";
import { PreparedFileHandoff } from "../files/prepared-file-handoff";
import { AgentRunPanel } from "./agent-run-panel";
import { ProposalCard } from "./proposal-card";

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
 * without making the user learn a separate grant-then-scan step.
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

type ProposalView = "summary" | "answers" | "known";
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
const getActiveTab = () =>
  browser.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => tab);

const pluralizeAnswer = (count: number) =>
  count === 1 ? "answer detected" : "answers detected";

const pluralizePlainAnswer = (count: number) =>
  count === 1 ? "answer" : "answers";

const pluralizeFilledAnswer = (count: number) =>
  count === 1 ? "answer filled" : "answers filled";

const pluralizeKnownField = (count: number) =>
  count === 1 ? "known field detected" : "known fields detected";

const findGrantedOriginForUrl = (
  url: string | undefined,
  grantedOrigins: readonly string[],
) => {
  if (!url) return undefined;

  try {
    const origin = toOriginPattern(url);
    return grantedOrigins.find((grantedOrigin) => grantedOrigin === origin);
  } catch {
    return undefined;
  }
};

const formatGrantedOrigin = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

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
}: {
  readonly state: ScanUiState;
  readonly grantedOrigin: string | undefined;
  readonly scannedAt: Date | undefined;
  readonly onScan: () => void;
  readonly onRevoke: (origin: string) => void;
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
      {grantedOrigin && (
        <div className="flex min-w-0 items-center justify-between gap-2 px-1 text-muted-foreground text-xs transition-all duration-300 ease-out motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-reduce:transition-none">
          <span className="min-w-0 truncate">
            Access is on for{" "}
            <span className="text-foreground">
              {formatGrantedOrigin(grantedOrigin)}
            </span>
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
}: {
  readonly count: number;
  readonly fillStatus: FillStatus;
  readonly onOpenDetails: () => void;
  readonly onFill: () => void;
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
        : "Open details to review every detected proposal.";

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
    subtitle="Open details to review every detected proposal."
  >
    <AgentRunPanel key={scanVersion} tabId={tabId} />
  </SummaryCardShell>
);

const UploadIntentItem = ({
  intent,
  onPrepare,
  output,
  error,
  onShowCurrentPage,
}: {
  readonly intent: UploadIntent;
  readonly onPrepare: (file: File) => Promise<void>;
  readonly output?: {
    readonly artifact: PreparedArtifact;
    readonly store: FileReferenceStore;
    readonly url: string;
    readonly name: string;
    readonly size: number;
    readonly mimeType: string;
  };
  readonly error?: string;
  readonly onShowCurrentPage?: () => void;
}) => {
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [sourceFile, setSourceFile] = useState<File>();
  const accept =
    intent.constraints
      .find((constraint) => constraint.kind === "accept")
      ?.value.join(",") ?? "image/*,application/pdf";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm">{intent.label ?? "Upload"}</p>
          <p className="text-muted-foreground text-xs">
            {intent.kind} ·{" "}
            {intent.actionability === "automatic"
              ? "native upload available"
              : "choose the prepared copy on the page"}
          </p>
        </div>
        <input
          className="max-w-32 text-xs"
          type="file"
          accept={accept}
          aria-label={`Choose ${intent.label ?? "upload"}`}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            if (sourceUrl) URL.revokeObjectURL(sourceUrl);
            setSourceFile(file);
            setSourceUrl(URL.createObjectURL(file));
          }}
        />
      </div>
      {sourceUrl && (
        <>
          {sourceFile?.type.startsWith("image/") ? (
            <div className="h-48 overflow-hidden rounded border bg-muted">
              <img
                src={sourceUrl}
                alt="Selected upload preview"
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="rounded border bg-muted/30 p-4 text-center text-muted-foreground text-xs">
              Document selected. Prepare a temporary upload copy locally.
            </div>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => sourceFile && void onPrepare(sourceFile)}
          >
            Prepare {intent.label?.toLowerCase() ?? intent.kind}
          </Button>
        </>
      )}
      <p className="line-clamp-4 text-muted-foreground text-xs">
        {intent.description}
      </p>
      {output && (
        <PreparedFileHandoff
          artifact={output.artifact}
          store={output.store}
          downloadUrl={output.url}
          label={intent.label ?? intent.kind}
          onShowCurrentPage={onShowCurrentPage}
        />
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
        readonly url: string;
        readonly artifact: PreparedArtifact;
        readonly store: FileReferenceStore;
        readonly name: string;
        readonly size: number;
        readonly mimeType: string;
      }
    >
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const showCurrentPage = async () => {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id !== undefined) {
      await browser.tabs.update(tab.id, { active: true });
    }
  };

  useEffect(
    () => () => {
      for (const output of Object.values(prepared)) {
        URL.revokeObjectURL(output.url);
      }
    },
    [prepared],
  );

  const prepare = async (intent: UploadIntent, file: File) => {
    setErrors((current) => ({ ...current, [intent.id]: "" }));
    try {
      const store = await createIndexedDbFileReferenceStore();
      const original = await store.save(file);
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
      if (!output.ok) {
        setErrors((current) => ({
          ...current,
          [intent.id]: output.reason,
        }));
        return;
      }
      const previous = prepared[intent.id];
      if (previous) URL.revokeObjectURL(previous.url);
      setPrepared((current) => ({
        ...current,
        [intent.id]: {
          url: URL.createObjectURL(output.artifact.blob),
          artifact: output.artifact,
          store,
          name: output.artifact.name,
          size: output.artifact.sizeBytes,
          mimeType: output.artifact.mimeType,
        },
      }));
    } catch {
      setErrors((current) => ({
        ...current,
        [intent.id]: "Local preparation failed.",
      }));
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-card p-3 shadow-sm">
      <div>
        <p className="font-semibold text-sm">
          {intents.length} upload{" "}
          {intents.length === 1 ? "requirement" : "requirements"} detected
        </p>
        <p className="text-muted-foreground text-xs">
          Original files stay unchanged. Prepared copies expire automatically.
        </p>
      </div>
      {intents.map((intent) => (
        <UploadIntentItem
          key={intent.id}
          intent={intent}
          output={prepared[intent.id]}
          error={errors[intent.id]}
          onShowCurrentPage={() => void showCurrentPage()}
          onPrepare={(file) => prepare(intent, file)}
        />
      ))}
    </section>
  );
};

export const FillPanel = () => {
  const sound = useSound();
  const [scanState, setScanState] = useState<ScanState>({ kind: "idle" });
  const [proposalView, setProposalView] = useState<ProposalView>("summary");
  const [proposalViewTransition, setProposalViewTransition] =
    useState<ProposalViewTransition>("none");
  const [scanVersion, setScanVersion] = useState(0);
  const [confirmedIds, setConfirmedIds] = useState<Set<DecisionId>>(new Set());
  const [fillStatus, setFillStatus] = useState<FillStatus>({ kind: "ready" });
  const [scanUiState, setScanUiState] = useState<ScanUiState>("idle");
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
    await applyActiveTab(await getActiveTab());
  }, [applyActiveTab]);

  useEffect(() => {
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
    return () => {
      browser.tabs.onActivated.removeListener(handleActivated);
      browser.tabs.onUpdated.removeListener(handleUpdated);
    };
  }, [refreshAccessState, applyActiveTab]);

  useEffect(() => {
    if (!lastScannedAt) return undefined;

    const interval = window.setInterval(() => {
      setClockTick((tick) => tick + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [lastScannedAt]);

  const scan = async () => {
    setScanUiState("scanning");
    setFillStatus({ kind: "ready" });
    sound.startLoop("scan-page", "scanStarted");
    // The user gesture that fires this handler is what makes
    // `permissions.request()` (inside `siteAccess.requestSiteAccess`)
    // valid — it must run here, synchronously reachable from the click,
    // not be proxied through a message to the background. Firefox is
    // stricter than Chrome about this: Chrome tolerates an `await` (e.g.
    // `browser.tabs.query()`) ahead of the request call, but Firefox
    // clears its "handling user input" flag as soon as control returns to
    // the event loop, so the same `await` there makes `permissions.request`
    // reject silently. `activeTabUrl`/`activeTabId` are cached from the
    // last `refreshAccessState()` so this handler's first async call can be
    // `requestSiteAccess` itself when access is missing.
    if (activeTabId === undefined || activeTabUrl === undefined) {
      setScanState({ kind: "not_granted" });
      setScanUiState("blocked");
      sound.stopLoop("scan-page");
      sound.play("scanBlocked");
      return;
    }

    try {
      if (!activeTabGranted) {
        const granted = await siteAccess.requestSiteAccess(
          activeTabUrl,
          activeTabId,
        );
        await refreshAccessState();
        if (!granted) {
          setScanState({ kind: "not_granted" });
          setScanUiState("blocked");
          sound.stopLoop("scan-page");
          sound.play("scanBlocked");
          return;
        }
      }

      const result = await sendMessage("runFill", { tabId: activeTabId });
      if (!result.granted) {
        setActiveTabGranted(false);
        setScanState({ kind: "not_granted" });
        setScanUiState("blocked");
        sound.stopLoop("scan-page");
        sound.play("scanBlocked");
        return;
      }
      setConfirmedIds(new Set());
      setProposalView("summary");
      setProposalViewTransition("none");
      setScanVersion((version) => version + 1);
      setScanState({
        kind: "proposals",
        proposals: result.proposals,
        uploadIntents: result.uploadIntents,
      });
      setLastScannedAt(new Date());
      setScanUiState("results");
      sound.stopLoop("scan-page");
      sound.play("scanSucceeded");
    } catch {
      // No content script reachable in this tab, or the permission request
      // failed. Same recovery as an outright missing grant: explain that
      // access is required and let the next scan click try again.
      setActiveTabGranted(false);
      setScanState({ kind: "not_granted" });
      setScanUiState("failed");
      sound.stopLoop("scan-page");
      sound.play("scanFailed");
    }
  };

  const revoke = async (origin: string) => {
    try {
      await siteAccess.revokeSiteAccess(origin);
      // Revoking the active tab's own origin must clear stale proposals
      // immediately, not just drop it from the granted-origins list.
      setScanState({ kind: "idle" });
      setFillStatus({ kind: "ready" });
      setScanUiState("idle");
      setLastScannedAt(undefined);
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
    try {
      const { results } = await sendMessage("confirmFill", {
        decisionIds,
        tabId: activeTabId,
      });
      const ok = new Set(results.filter((r) => r.ok).map((r) => r.decisionId));
      setConfirmedIds((prev) => new Set([...prev, ...ok]));
      if (ok.size === decisionIds.length) {
        setFillStatus({ kind: "filled", filledCount: ok.size });
        setScanUiState("filled");
        outcome = "fillSucceeded";
      } else if (ok.size > 0) {
        setFillStatus({
          kind: "partial",
          attemptedCount: decisionIds.length,
          filledCount: ok.size,
        });
      } else {
        setFillStatus({
          kind: "failed",
          attemptedCount: decisionIds.length,
        });
      }
    } catch {
      setFillStatus({ kind: "failed", attemptedCount: decisionIds.length });
      outcome = "fillFailed";
    } finally {
      sound.stopLoop("confirm-fill");
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
    (proposalView === "answers" || proposalView === "known");
  const activeGrantedOrigin = activeTabGranted
    ? findGrantedOriginForUrl(activeTabUrl, grantedOrigins)
    : undefined;

  return (
    <div className="flex w-full flex-col gap-4">
      <ScanToolbar
        state={scanUiState}
        grantedOrigin={activeGrantedOrigin}
        scannedAt={lastScannedAt}
        onScan={scan}
        onRevoke={revoke}
      />

      <Separator />

      {scanState.kind === "not_granted" && (
        <p className="text-muted-foreground text-sm">
          This site needs access before it can be scanned. Use "Scan this page"
          and approve the browser prompt to continue.
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
              setProposalViewTransition("back");
              setProposalView("summary");
              sound.play("proposalDetailsClosed");
            }}
          >
            <ChevronLeft className="size-4" />
            Back
          </Button>
          {detailsProposals.map((proposal) => (
            <ProposalCard
              key={proposal.fieldId}
              proposal={proposal}
              onConfirm={(decisionId) => confirm([decisionId])}
              confirmedIds={confirmedIds}
            />
          ))}
        </div>
      ) : (
        scanState.kind === "proposals" && (
          <div
            className={cn(
              "flex flex-col gap-4 motion-reduce:animate-none",
              proposalViewMotionClass,
            )}
          >
            <AnswersSummaryCard
              count={answeredDecisionIds.length}
              fillStatus={fillStatus}
              onOpenDetails={() => {
                setProposalViewTransition("forward");
                setProposalView("answers");
                sound.play("proposalDetailsOpened");
              }}
              onFill={() => confirm(answeredDecisionIds)}
            />
            <KnownFieldsSummaryCard
              count={knownNoAnswerProposals.length}
              onOpenDetails={() => {
                setProposalViewTransition("forward");
                setProposalView("known");
                sound.play("proposalDetailsOpened");
              }}
              tabId={activeTabId}
              scanVersion={scanVersion}
            />
            {scanState.uploadIntents.length > 0 && (
              <UploadIntentsCard intents={scanState.uploadIntents} />
            )}
          </div>
        )
      )}
    </div>
  );
};
