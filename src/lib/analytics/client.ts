import { OpenPanel } from "@openpanel/sdk";
import env from "../../../env.config";

/**
 * `@openpanel/sdk` (the minimal core client), not `@openpanel/web` — the web
 * SDK bundles automatic screen-view/outgoing-link tracking and a session
 * replay module. This product's entire premise is that nothing reads page
 * content; depending on a package whose purpose is partly to do that is the
 * wrong default even with those features left off. See
 * docs/adr/010-product-analytics.md.
 *
 * Analytics is optional. With no OpenPanel configuration the extension runs
 * fully local and anonymous — the default experience, matching
 * src/lib/supabase.ts's pattern for auth.
 */
export const analyticsClient: OpenPanel | null = env.VITE_OPENPANEL_CLIENT_ID
  ? new OpenPanel({ clientId: env.VITE_OPENPANEL_CLIENT_ID })
  : null;

export const isAnalyticsConfigured = analyticsClient !== null;
