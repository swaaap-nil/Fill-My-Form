import { useCallback, useEffect, useState } from "react";
import type { Browser } from "wxt/browser";
import { browser } from "wxt/browser";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import type { DecisionId, FieldProposal } from "~/lib/messaging";
import { sendMessage } from "~/lib/messaging";
import { siteAccess } from "~/lib/site-access";
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
    };

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

export const FillPanel = () => {
  const [scanState, setScanState] = useState<ScanState>({ kind: "idle" });
  const [scanVersion, setScanVersion] = useState(0);
  const [confirmedIds, setConfirmedIds] = useState<Set<DecisionId>>(new Set());
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

  const scan = async () => {
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
          return;
        }
      }

      const result = await sendMessage("runFill", { tabId: activeTabId });
      if (!result.granted) {
        setActiveTabGranted(false);
        setScanState({ kind: "not_granted" });
        return;
      }
      setConfirmedIds(new Set());
      setScanVersion((version) => version + 1);
      setScanState({ kind: "proposals", proposals: result.proposals });
    } catch {
      // No content script reachable in this tab, or the permission request
      // failed. Same recovery as an outright missing grant: explain that
      // access is required and let the next scan click try again.
      setActiveTabGranted(false);
      setScanState({ kind: "not_granted" });
    }
  };

  const revoke = async (origin: string) => {
    await siteAccess.revokeSiteAccess(origin);
    // Revoking the active tab's own origin must clear stale proposals
    // immediately, not just drop it from the granted-origins list.
    setScanState({ kind: "idle" });
    await refreshAccessState();
  };

  const confirm = async (decisionIds: readonly DecisionId[]) => {
    if (activeTabId === undefined) return;
    const { results } = await sendMessage("confirmFill", {
      decisionIds,
      tabId: activeTabId,
    });
    const ok = new Set(results.filter((r) => r.ok).map((r) => r.decisionId));
    setConfirmedIds((prev) => new Set([...prev, ...ok]));
  };

  const pendingDecisionIds: DecisionId[] =
    scanState.kind === "proposals"
      ? scanState.proposals.flatMap((p) =>
          p.state === "pending" && !confirmedIds.has(p.decisionId)
            ? [p.decisionId]
            : [],
        )
      : [];

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm shadow-black/5 dark:shadow-black/20">
        <Button type="button" onClick={scan}>
          Scan this page
        </Button>
      </div>

      {grantedOrigins.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
          <p className="font-medium text-xs">Sites you've granted access to</p>
          {grantedOrigins.map((origin) => (
            <div
              key={origin}
              className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs"
            >
              <span className="truncate text-muted-foreground">{origin}</span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => revoke(origin)}
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}

      {scanState.kind === "proposals" && (
        <AgentRunPanel key={scanVersion} tabId={activeTabId} />
      )}

      <Separator />

      {scanState.kind === "not_granted" && (
        <p className="text-muted-foreground text-sm">
          This site needs access before it can be scanned. Use "Scan this page"
          and approve the browser prompt to continue.
        </p>
      )}

      {scanState.kind === "proposals" && (
        <>
          {pendingDecisionIds.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => confirm(pendingDecisionIds)}
            >
              Confirm all ({pendingDecisionIds.length})
            </Button>
          )}
          <div className="flex flex-col gap-2">
            {scanState.proposals.map((proposal) => (
              <ProposalCard
                key={proposal.fieldId}
                proposal={proposal}
                onConfirm={(decisionId) => confirm([decisionId])}
                confirmed={
                  (proposal.state === "pending" ||
                    proposal.state === "restricted") &&
                  confirmedIds.has(proposal.decisionId)
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
