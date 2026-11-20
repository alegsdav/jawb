import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readQuota, usageSummary, withAiBudget } from "@/lib/aiBudget";

type Read = { data?: unknown; error?: unknown } | "throw";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const now = new Date(NOW);
const inTwoHours = new Date(NOW + 2 * 3600000).toISOString();
const past = new Date(NOW - 60000).toISOString();

const row = (over: Record<string, unknown> = {}) => ({
  heavy_limit: 10, heavy_remaining: 7, heavy_resets_at: null,
  light_limit: 120, light_remaining: 120, light_resets_at: null,
  ...over,
});

/** A Supabase stand-in: the ai_quotas read returns `read` (or throws); reserve_ai_call finds no room. */
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
    rpc: async (name: string) => {
      if (name !== "reserve_ai_call") throw new Error(`unexpected rpc ${name}`);
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
}

const env = { AI_HEAVY_PER_DAY: "10", AI_LIGHT_PER_HOUR: "50" };

afterEach(() => vi.restoreAllMocks());

describe("readQuota", () => {
  it("returns the user's own limits and calls left, per weight", async () => {
    const q = await readQuota(quotaDb({ data: row() }), now);
    expect(q).toEqual({
      heavy: { limit: 10, remaining: 7, resetAt: null },
      light: { limit: 120, remaining: 120, resetAt: null },
    });
  });

  it("keeps a running window: remaining 0 with its reset time", async () => {
    const q = await readQuota(quotaDb({ data: row({ heavy_remaining: 0, heavy_resets_at: inTwoHours }) }), now);
    expect(q?.heavy).toEqual({ limit: 10, remaining: 0, resetAt: inTwoHours });
  });

  it("a window that has passed reads as full (the next call refills it)", async () => {
    const q = await readQuota(quotaDb({ data: row({ heavy_remaining: 0, heavy_resets_at: past }) }), now);
    expect(q?.heavy).toEqual({ limit: 10, remaining: 10, resetAt: null });
  });

  it("a limit of 0 is returned as 0", async () => {
    const q = await readQuota(quotaDb({ data: row({ light_limit: 0, light_remaining: 0 }) }), now);
    expect(q?.light).toEqual({ limit: 0, remaining: 0, resetAt: null });
  });

  it("no row gives null", async () => {
    expect(await readQuota(quotaDb({ data: null }), now)).toBeNull();
  });

  it("a missing table (migration 0008 not run) gives null, without a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = { code: "PGRST205", message: "Could not find the table 'public.ai_quotas' in the schema cache" };
    expect(await readQuota(quotaDb({ error: err }), now)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("a missing column (42703) gives null, without a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = { code: "42703", message: 'column "heavy_remaining" does not exist' };
    expect(await readQuota(quotaDb({ error: err }), now)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("another read error gives null and logs a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await readQuota(quotaDb({ error: { code: "42501", message: "permission denied" } }), now)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("never throws: a thrown read gives null", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(readQuota(quotaDb("throw"), now)).resolves.toBeNull();
  });
});

describe("usageSummary with a quota row", () => {
  it("normal: used, limit and left come from the row", async () => {
    expect(await usageSummary(quotaDb({ data: row() }), now, env)).toEqual({
      available: true,
      heavy: { used: 3, limit: 10, remaining: 7, resetAt: null },
      light: { used: 0, limit: 120, remaining: 120, resetAt: null },
    });
  });

  it("remaining 0 shows when it frees up", async () => {
    const s = await usageSummary(quotaDb({ data: row({ heavy_remaining: 0, heavy_resets_at: inTwoHours }) }), now, env);
    expect(s).toMatchObject({ heavy: { used: 10, remaining: 0, resetAt: inTwoHours } });
  });

  it("a past reset time shows the bucket refilled", async () => {
    const s = await usageSummary(quotaDb({ data: row({ heavy_remaining: 0, heavy_resets_at: past }) }), now, env);
    expect(s).toMatchObject({ heavy: { used: 0, remaining: 10, resetAt: null } });
  });

  it("limit 0 shows no calls at all", async () => {
    const s = await usageSummary(quotaDb({ data: row({ light_limit: 0, light_remaining: 0 }) }), now, env);
    expect(s).toMatchObject({ light: { used: 0, limit: 0, remaining: 0, resetAt: null } });
  });
});

describe("the 429 message with a quota row", () => {
  it("uses the quota's limit and reset time, not the env limit", async () => {
    const client = quotaDb({ data: row({ heavy_limit: 4, heavy_remaining: 0, heavy_resets_at: inTwoHours }) });
    const err = await withAiBudget(client, { action: "analyze", env, now: () => now }, async () => "ok").catch((e) => e);
    expect(err).toMatchObject({ status: 429, weight: "heavy", resetAt: inTwoHours });
    expect(err.message).toBe(
      "You've used all 4 of your analyses for the last 24 hours (job analyses, resume imports and resume drafts count). The next one opens up in about 2 hours.",
    );
  });
});

describe("migration 0008_ai_quota_counters.sql", () => {
  const sql = readFileSync("supabase/migrations/0008_ai_quota_counters.sql", "utf8");

  it("a limit of 0 blocks calls even with some remaining, and lowering a limit caps remaining", () => {
    expect(sql).toContain("if q.heavy_limit <= 0 or q.heavy_remaining <= 0 then");
    expect(sql).toContain("if q.light_limit <= 0 or q.light_remaining <= 0 then");
    expect(sql).toContain("new.heavy_remaining := least(new.heavy_remaining, new.heavy_limit);");
    expect(sql).toContain("new.light_remaining := least(new.light_remaining, new.light_limit);");
  });

  it("an edit to remaining after the window passed restarts it; refunds happen only inside a running window", () => {
    expect(sql).toMatch(/new\.heavy_resets_at <= now\(\) then\s+new\.heavy_resets_at := null;/);
    expect(sql).toMatch(/new\.light_resets_at <= now\(\) then\s+new\.light_resets_at := null;/);
    expect(sql).toContain("(heavy_resets_at is null or heavy_resets_at > now())");
    expect(sql).toContain("(light_resets_at is null or light_resets_at > now())");
  });

  it("defines reserve_ai_call and finish_ai_call with the same signatures as 0004", () => {
    expect(sql).toMatch(/create or replace function public\.reserve_ai_call\(p_action text, p_weight text, p_limit int, p_window interval\)/);
    expect(sql).toMatch(
      /create or replace function public\.finish_ai_call\(\s*p_id uuid, p_status text, p_prompt int, p_output int, p_total int, p_model text default ''\s*\)/,
    );
  });

  it("locks the user's quota row while reserving a call", () => {
    expect(sql).toMatch(/from public\.ai_quotas where user_id = v_uid for update/);
  });

  it("drops both admin functions from 0007", () => {
    expect(sql).toMatch(/drop function if exists public\.admin_set_ai_quota\(/);
    expect(sql).toMatch(/drop function if exists public\.admin_ai_quota_status\(/);
  });

  it("creates the trigger that gives every new account a quota row", () => {
    expect(sql).toMatch(/create trigger ai_quotas_new_user after insert on auth\.users/);
  });
});
