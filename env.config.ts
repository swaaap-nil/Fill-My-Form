import { defineEnv } from "envin";
import { z } from "zod";
import { AppEnv, NodeEnv } from "./src/types";

/**
 * Every variable here is bundled into the extension and is therefore PUBLIC.
 * Server-only secrets (OPENAI_API_KEY, STRIPE_SECRET_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, ...) must never appear in this file or in `.env`.
 * See docs/privacy.md.
 *
 * The cloud integrations below are OPTIONAL by design: the extension is
 * local-first and must boot and be useful with an empty `.env`. Each
 * integration no-ops when its key is absent.
 */
export default defineEnv({
  shared: {
    NODE_ENV: z.nativeEnum(NodeEnv).default(NodeEnv.DEVELOPMENT),
  },
  clientPrefix: "VITE_",
  client: {
    VITE_APP_ENV: z.nativeEnum(AppEnv).default(AppEnv.DEVELOPMENT),

    // Cloud-eligible: authentication only. Never personal memory.
    VITE_SUPABASE_URL: z.string().url().optional(),
    VITE_SUPABASE_ANON_KEY: z.string().min(1).optional(),

    // Cloud-eligible: anonymous product analytics only. See
    // docs/adr/010-product-analytics.md and docs/privacy.md.
    VITE_OPENPANEL_CLIENT_ID: z.string().min(1).optional(),
  },
  env: {
    VITE_APP_ENV: import.meta.env.VITE_APP_ENV,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_OPENPANEL_CLIENT_ID: import.meta.env.VITE_OPENPANEL_CLIENT_ID,
  },
  skip:
    (!!import.meta.env.SKIP_ENV_VALIDATION &&
      ["1", "true"].includes(import.meta.env.SKIP_ENV_VALIDATION)) ||
    import.meta.env.npm_lifecycle_event === "lint",
});
