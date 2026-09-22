import { browser } from "#imports";
import { CheckboxField } from "~/components/ui/checkbox";
import { useAnalyticsPreference } from "~/lib/analytics/react";

const message = (
  key: "analyticsPreferenceLabel" | "analyticsPreferenceDescription",
) => browser.i18n.getMessage(key);

/**
 * The analytics opt-out toggle. Renders nothing when analytics isn't
 * configured (no VITE_OPENPANEL_CLIENT_ID) — there is nothing to opt out of.
 * See docs/adr/010-product-analytics.md.
 */
export const AnalyticsPreferenceControl = () => {
  const analytics = useAnalyticsPreference();

  if (!analytics.configured) return null;

  return (
    <section className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
      <CheckboxField
        id="analytics-preference"
        label={message("analyticsPreferenceLabel")}
        checked={analytics.enabled}
        onCheckedChange={analytics.setEnabled}
      />
      <p className="text-muted-foreground text-xs">
        {message("analyticsPreferenceDescription")}
      </p>
    </section>
  );
};
