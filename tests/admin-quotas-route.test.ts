import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Rpc = { name: string; args: Record<string, unknown> };
type RpcResult = { data?: unknown; error?: { code?: string; message: string } | null };

const h = vi.hoisted(() => ({
  email: "owner@example.com" as string | null,
  adminDb: true,
  rpcs: [] as Rpc[],
  /** Per rpc name: what it returns. */
  reply: {} as Record<string, RpcResult>,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireUser: async () => ({ supabase: {}, user: h.email ? { id: "u", email: h.email } : null }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    h.adminDb
      ? {
          rpc: async (name: string, args: Record<string, unknown>) => {
            h.rpcs.push({ name, args });
            return h.reply[name] ?? { data: null, error: null };
          },
        }
      : null,
}));

import { GET, POST } from "@/app/api/admin/quotas/route";
import { MIGRATION_HINT } from "@/lib/db";

const USER_ID = "11111111-2222-4333-8444-555555555555";

const statusRow = (over: Record<string, unknown> = {}) => ({
  user_id: USER_ID,
  email: "ann@example.com",
  heavy_limit: 10,
  heavy_is_default: true,
  heavy_used: 3,
  light_limit: 4,
  light_is_default: false,
  light_used: 9,
  ...over,
});

const post = (body: unknown) =>
  POST(new Request("http://x/api/admin/quotas", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "Owner@Example.com");
  vi.stubEnv("AI_HEAVY_PER_DAY", "10");
  vi.stubEnv("AI_LIGHT_PER_HOUR", "120");
  h.email = "owner@example.com";
  h.adminDb = true;
  h.rpcs = [];
  h.reply = {};
});

afterEach(() => vi.unstubAllEnvs());

describe("access", () => {
  it("404 for a signed-in user who is not an admin", async () => {
    h.email = "ann@example.com";
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect((await post({ userId: USER_ID, weight: "heavy", limit: 1, remaining: null })).status).toBe(404);
    expect(h.rpcs).toEqual([]);
  });

  it("404 when nobody is signed in", async () => {
    h.email = null;
    const res = await GET();
    expect(res.status).toBe(404);
    expect(h.rpcs).toEqual([]);
  });

  it("503 without the service-role key", async () => {
    h.adminDb = false;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Set SUPABASE_SERVICE_ROLE_KEY to manage AI limits." });
  });
});

describe("GET /api/admin/quotas", () => {
  it("returns each user's limits, calls left (never below 0) and the env defaults", async () => {
    h.reply.admin_ai_quota_status = {
      data: [statusRow(), statusRow({ user_id: "other", email: "bo@example.com", light_used: 2, heavy_used: 30 })],
    };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      users: [
        {
          userId: USER_ID,
          email: "ann@example.com",
          heavy: { limit: 10, isDefault: true, used: 3, remaining: 7 },
          light: { limit: 4, isDefault: false, used: 9, remaining: 0 },
        },
        {
          userId: "other",
          email: "bo@example.com",
          heavy: { limit: 10, isDefault: true, used: 30, remaining: 0 },
          light: { limit: 4, isDefault: false, used: 2, remaining: 2 },
        },
      ],
      defaults: { heavy: 10, light: 120 },
    });
  });

  it("passes the env defaults and windows to the status rpc", async () => {
    await GET();
    expect(h.rpcs).toEqual([
      {
        name: "admin_ai_quota_status",
        args: { p_heavy_default: 10, p_light_default: 120, p_heavy_window: "24 hours", p_light_window: "60 minutes" },
      },
    ]);
  });

  it("503 with the migration hint when migration 0007 isn't run", async () => {
    h.reply.admin_ai_quota_status = {
      error: { code: "42883", message: "function public.admin_ai_quota_status(integer, integer, interval, interval) does not exist" },
    };
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: MIGRATION_HINT });
  });
});

describe("POST /api/admin/quotas validation", () => {
  it.each([
    ["bad userId", { userId: "not-a-uuid", weight: "heavy", limit: 5, remaining: null }],
    ["unknown weight", { userId: USER_ID, weight: "medium", limit: 5, remaining: null }],
    ["negative limit", { userId: USER_ID, weight: "heavy", limit: -1, remaining: null }],
    ["fractional limit", { userId: USER_ID, weight: "light", limit: 2.5, remaining: null }],
    ["text remaining", { userId: USER_ID, weight: "light", limit: null, remaining: "3" }],
    ["missing remaining", { userId: USER_ID, weight: "light", limit: null }],
  ])("400 for %s, and nothing is written", async (_, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request." });
    expect(h.rpcs).toEqual([]);
  });

  it("400 for a body that isn't JSON", async () => {
    const res = await POST(new Request("http://x/api/admin/quotas", { method: "POST", body: "{nope" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/quotas", () => {
  it("sets a total and calls the rpc with the weight's default and window", async () => {
    h.reply.admin_set_ai_quota = { data: null, error: null };
    h.reply.admin_ai_quota_status = { data: [statusRow({ heavy_limit: 5, heavy_is_default: false, heavy_used: 1 })] };
    const res = await post({ userId: USER_ID, weight: "heavy", limit: 5, remaining: null });
    expect(res.status).toBe(200);
    expect(h.rpcs[0]).toEqual({
      name: "admin_set_ai_quota",
      args: { p_user: USER_ID, p_weight: "heavy", p_limit: 5, p_default: 10, p_remaining: null, p_window: "24 hours" },
    });
  });

  it("clears the total with null and sets remaining for the light weight", async () => {
    h.reply.admin_ai_quota_status = { data: [statusRow()] };
    await post({ userId: USER_ID, weight: "light", limit: null, remaining: 6 });
    expect(h.rpcs[0]).toEqual({
      name: "admin_set_ai_quota",
      args: { p_user: USER_ID, p_weight: "light", p_limit: null, p_default: 120, p_remaining: 6, p_window: "60 minutes" },
    });
  });

  it("returns the user's updated row, in the GET shape", async () => {
    h.reply.admin_ai_quota_status = { data: [statusRow({ heavy_limit: 5, heavy_is_default: false, heavy_used: 1 })] };
    const res = await post({ userId: USER_ID, weight: "heavy", limit: 5, remaining: null });
    expect(await res.json()).toEqual({
      user: {
        userId: USER_ID,
        email: "ann@example.com",
        heavy: { limit: 5, isDefault: false, used: 1, remaining: 4 },
        light: { limit: 4, isDefault: false, used: 9, remaining: 0 },
      },
    });
  });

  it("404 when no auth user has that id", async () => {
    h.reply.admin_set_ai_quota = { error: { code: "23503", message: "insert violates foreign key" } };
    const res = await post({ userId: USER_ID, weight: "heavy", limit: 5, remaining: null });
    expect(res.status).toBe(404);
  });

  it("503 with the migration hint when the set function isn't there", async () => {
    h.reply.admin_set_ai_quota = { error: { code: "42883", message: "function admin_set_ai_quota does not exist" } };
    const res = await post({ userId: USER_ID, weight: "heavy", limit: 5, remaining: null });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: MIGRATION_HINT });
  });
});
