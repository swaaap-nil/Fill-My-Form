import { OpenPanel } from "@openpanel/web";
import env from "../../env.config";

/**
 * Analytics is opt-in via configuration: with no `VITE_OPEN_PANEL_KEY` the
 * extension makes no analytics requests at all.
 *
 * Only anonymous product events belong here. Personal memory values, form
 * field values, file contents and page content must never be passed to
 * `track`. Use `redact` from `~/core/logging` if in doubt.
 */
const client = env.VITE_OPEN_PANEL_KEY
  ? new OpenPanel({
      clientId: env.VITE_OPEN_PANEL_KEY,
      trackScreenViews: true,
      trackOutgoingLinks: true,
      trackAttributes: true,
    })
  : null;

export const isAnalyticsEnabled = client !== null;

export const track: OpenPanel["track"] = async (...args) => {
  if (!client) return;
  return client.track(...args);
};
