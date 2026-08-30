import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { storage } from "#imports";
import env from "../../env.config";

const storageAdapter = {
  getItem: async (key: string) =>
    (await storage.getItem<string>(`local:${key}`)) || null,
  setItem: async (key: string, value: string) => {
    await storage.setItem(`local:${key}`, value);
  },
  removeItem: (key: string) => storage.removeItem(`local:${key}`),
};

/**
 * Authentication is optional. With no Supabase configuration the extension
 * runs fully local and anonymous — which is the default experience.
 *
 * Supabase is cloud-eligible for auth, subscription and shared (non-personal)
 * website knowledge only. Personal memory never leaves the device through it.
 * See docs/privacy.md.
 */
export const supabase: SupabaseClient | null =
  env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY
    ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
        auth: {
          storage: storageAdapter,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      })
    : null;

export const isAuthEnabled = supabase !== null;

/**
 * For call sites that only run inside auth UI, which is not reachable when
 * auth is disabled. Throws rather than silently no-opping, so a
 * misconfiguration surfaces instead of producing a dead button.
 */
export const requireSupabase = (): SupabaseClient => {
  if (!supabase) {
    throw new Error(
      "Authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to enable it.",
    );
  }
  return supabase;
};
