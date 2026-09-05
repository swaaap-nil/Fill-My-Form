import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import type { DecisionId, FieldProposal } from "~/lib/messaging";
import { sendMessage } from "~/lib/messaging";
import { siteAccess } from "~/lib/site-access";
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
 * "Grant access" is its own, always-present button rather than one that
 * only appears after a failed scan — the runtime half of the privacy
 * design (`~/lib/site-access`) had zero UI callers before this phase, and
 * a reachable, deliberate action is the point, not a fallback surfaced by
 * accident.
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

export const FillPanel = () => {
  const [scanState, setScanState] = useState<ScanState>({ kind: "idle" });
  const [confirmedIds, setConfirmedIds] = useState<Set<DecisionId>>(new Set());
  const [grantedOrigins, setGrantedOrigins] = useState<readonly string[]>([]);

  const refreshGrantedOrigins = useCallback(async () => {
    setGrantedOrigins(await siteAccess.listGrantedOrigins());
  }, []);

  useEffect(() => {
    refreshGrantedOrigins();
  }, [refreshGrantedOrigins]);

  const scan = async () => {
    try {
      const result = await sendMessage("runFill", undefined);
      if (!result.granted) {
        setScanState({ kind: "not_granted" });
        return;
      }
      setScanState({ kind: "proposals", proposals: result.proposals });
    } catch {
      // No content script reachable in this tab — typically because access
      // was granted after the tab was already open (see spike 2 in the
      // phase 1c handback) and it has not been reloaded yet. Same recovery
      // as an outright missing grant: ask for access again.
      setScanState({ kind: "not_granted" });
    }
  };

  const grantAccess = async () => {
    // The user gesture that fires this handler is what makes
    // `permissions.request()` (inside `siteAccess.requestSiteAccess`)
    // valid — it must run here, synchronously reachable from the click,
    // not be proxied through a message to the background.
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.url) {
      await siteAccess.requestSiteAccess(tab.url, tab.id);
    }
    await refreshGrantedOrigins();
  };

  const revoke = async (origin: string) => {
    await siteAccess.revokeSiteAccess(origin);
    await refreshGrantedOrigins();
  };

  const confirm = async (decisionIds: readonly DecisionId[]) => {
    const { results } = await sendMessage("confirmFill", { decisionIds });
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
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" onClick={grantAccess}>
          Grant access to this site
        </Button>
        <Button type="button" onClick={scan}>
          Scan this page
        </Button>
      </div>

      {grantedOrigins.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="font-medium text-xs">Sites you've granted access to</p>
          {grantedOrigins.map((origin) => (
            <div
              key={origin}
              className="flex items-center justify-between gap-2 text-xs"
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

      <Separator />

      {scanState.kind === "not_granted" && (
        <p className="text-muted-foreground text-sm">
          This site hasn't been granted access yet — use "Grant access to this
          site" above, then scan again.
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
