import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiLimits, limitMessage, userLimits } from "@/lib/aiBudget";
import { adminEmails, isAdminEmail } from "@/lib/admin";

type Read = { data?: unknown; error?: unknown } | "throw";

/** A Supabase stand-in whose ai_quotas read returns `read` (or throws). */
function quotaDb(read: Read) {
  return {
    from: (table: string) => {
      if (table !== "ai_quotas") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          maybeSingle: async () => {
            if (read === "throw") throw new Error("network down");
            return { data: read.data ?? null, error: read.error ?? null };
          },
        }),
      };
    },
  } as unknown as SupabaseClient;
}

const env = { AI_HEAVY_PER_DAY: "10", AI_LIGHT_PER_HOUR: "50" };

afterEach(() => vi.restoreAllMocks());

describe("userLimits", () => {
  it("an override replaces the env limit for that weight only", async () => {
    const lim = await userLimits(quotaDb({ data: { heavy_limit: 2, light_limit: null } }), env);
    expect(lim.heavy).toEqual({ limit: 2, windowMs: 86400000, interval: "24 hours" });
    expect(lim.light).toEqual({ limit: 50, windowMs: 3600000, interval: "60 minutes" });
  });

  it("null overrides and no row both mean the env limits", async () => {
    const env0 = aiLimits(env);
    expect(await userLimits(quotaDb({ data: { heavy_limit: null, light_limit: null } }), env)).toEqual(env0);
    expect(await userLimits(quotaDb({ data: null }), env)).toEqual(env0);
  });

  it("a missing table (migration 0007 not run) gives the env limits, without a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lim = await userLimits(quotaDb({ error: { code: "PGRST205", message: "Could not find the table 'public.ai_quotas' in the schema cache" } }), env);
    expect(lim).toEqual(aiLimits(env));
    expect(warn).not.toHaveBeenCalled();
  });

  it("another read error gives the env limits and logs a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lim = await userLimits(quotaDb({ error: { code: "42501", message: "permission denied" } }), env);
    expect(lim).toEqual(aiLimits(env));
    expect(warn).toHaveBeenCalled();
  });

  it("never throws: a thrown read gives the env limits", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(userLimits(quotaDb("throw"), env)).resolves.toEqual(aiLimits(env));
  });

  it("a limit of 0 is kept: that user is turned off for the weight", async () => {
    const lim = await userLimits(quotaDb({ data: { heavy_limit: 0, light_limit: 0 } }), env);
    expect(lim.heavy.limit).toBe(0);
    expect(lim.light.limit).toBe(0);
    expect(lim.heavy.windowMs).toBe(86400000);
  });
});

describe("limitMessage with a limit of 0", () => {
  it("says the account's AI is off, for each weight", () => {
    expect(limitMessage("heavy", { limit: 0, windowMs: 86400000, interval: "24 hours" }, null)).toBe(
      "AI analyses are turned off for your account.",
    );
    expect(limitMessage("light", { limit: 0, windowMs: 3600000, interval: "60 minutes" }, "2026-11-20T10:00:00.000Z")).toBe(
      "Quick AI actions are turned off for your account.",
    );
  });
});

describe("admin emails", () => {
  const raw = " Owner@Example.com , second@example.org ";

  it("parses a trimmed, lowercased list", () => {
    expect(adminEmails(raw)).toEqual(["owner@example.com", "second@example.org"]);
    expect(adminEmails("")).toEqual([]);
  });

  it("matches listed emails case-insensitively and nobody else", () => {
    expect(isAdminEmail("owner@example.com", raw)).toBe(true);
    expect(isAdminEmail("  SECOND@example.org ", raw)).toBe(true);
    expect(isAdminEmail("someone@example.com", raw)).toBe(false);
    expect(isAdminEmail(null, raw)).toBe(false);
    expect(isAdminEmail(undefined, raw)).toBe(false);
  });

  it("an empty list means nobody is an admin", () => {
    expect(isAdminEmail("owner@example.com", "")).toBe(false);
  });
});
