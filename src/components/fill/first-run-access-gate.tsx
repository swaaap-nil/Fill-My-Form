import { Globe, Shield } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { getActiveBrowserTab } from "~/lib/active-browser-tab";
import { markFirstRunSiteAccess } from "~/lib/first-run-access";
import { runFirstRunAllSitesGrant } from "~/lib/first-run-grant-flow";
import { isPermissibleUrl, siteAccess } from "~/lib/site-access";

interface FirstRunAccessGateProps {
  readonly onComplete: () => void;
}

export const FirstRunAccessGate = ({ onComplete }: FirstRunAccessGateProps) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const handleContinue = async () => {
    setBusy(true);
    setError(undefined);
    // `permissions.request` must be the first async call from this click.
    // Awaiting `tabs.query` first (for tab id) breaks the user gesture in
    // Firefox and some Chrome builds — same rule as scan in `fill-panel.tsx`.
    const outcome = await runFirstRunAllSitesGrant({
      requestAllSiteAccess: () => siteAccess.requestAllSiteAccess(),
      markFirstRunSiteAccess,
    });
    setBusy(false);
    if (outcome.kind === "failed") {
      setError("Could not request access. Try again from this button.");
      return;
    }
    if (!outcome.granted) {
      setError(
        "Permission was not granted. Try again, or choose Not now to allow one site at a time when you scan.",
      );
      return;
    }
    const tab = await getActiveBrowserTab();
    if (tab?.id !== undefined && tab.url && isPermissibleUrl(tab.url)) {
      await siteAccess.syncScriptsForGrantedAccess(tab.url, tab.id);
    }
    onComplete();
  };

  const handleDecline = async () => {
    await markFirstRunSiteAccess({ globalDeclined: true });
    onComplete();
  };

  return (
    <div
      className="flex w-full flex-col gap-5 rounded-lg border border-border bg-card/60 p-5"
      data-testid="first-run-access-gate"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Globe className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-2">
          <h2 className="font-semibold text-lg leading-snug">
            Detect forms automatically
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Allow access to websites so Fill My Form can notice application and
            signup forms in the background. You will get a notification when we
            find fields that match your saved answers — no need to open the
            extension on every site.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
        <Shield className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="text-muted-foreground leading-relaxed">
          Matching runs entirely on this device. Your answers are not uploaded
          for detection. You can revoke access anytime in this panel or in
          browser settings.
        </p>
      </div>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void handleDecline()}
        >
          Not now
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={() => void handleContinue()}
        >
          {busy ? "Waiting for permission…" : "Allow on all websites"}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        If you choose Not now, you can still grant access one site at a time
        when you scan a page.
      </p>
    </div>
  );
};
