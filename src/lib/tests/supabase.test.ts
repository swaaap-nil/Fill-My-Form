import { describe, expect, it, mock } from "bun:test";

mock.module("#imports", () => ({
  storage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

describe("supabase", () => {
  it("is null under an empty env, so auth is unreachable by default", async () => {
    const { supabase, isAuthEnabled } = await import("~/lib/supabase");

    expect(supabase).toBeNull();
    expect(isAuthEnabled).toBe(false);
  });
});
