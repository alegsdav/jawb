import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { aiLimits } from "@/lib/aiBudget";
import { isMissingRelation, MIGRATION_HINT } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Admin only (ADMIN_EMAILS): each user's AI limits per weight, and how many calls they have left.
 * Everyone else gets a 404, so the page doesn't reveal that it exists. Writes go through the service
 * role (the rpcs from migration 0007), since users can't write their own ai_quotas row.
 */

type Gate = { ok: true; db: SupabaseClient } | { ok: false; res: NextResponse };

async function gate(): Promise<Gate> {
  const { user } = await requireUser();
  if (!user || !isAdminEmail(user.email)) {
    return { ok: false, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const db = createAdminClient();
  if (!db) {
    return {
      ok: false,
      res: NextResponse.json({ error: "Set SUPABASE_SERVICE_ROLE_KEY to manage AI limits." }, { status: 503 }),
    };
  }
  return { ok: true, db };
}

/** One row of admin_ai_quota_status. */
type StatusRow = {
  user_id: string;
  email: string;
  heavy_limit: number;
  heavy_is_default: boolean;
  heavy_used: number;
  light_limit: number;
  light_is_default: boolean;
  light_used: number;
};

const bucket = (limit: number, isDefault: boolean, used: number) => ({
  limit,
  isDefault,
  used,
  remaining: Math.max(0, limit - used),
});

const toUser = (r: StatusRow) => ({
  userId: r.user_id,
  email: r.email,
  heavy: bucket(r.heavy_limit, r.heavy_is_default, r.heavy_used),
  light: bucket(r.light_limit, r.light_is_default, r.light_used),
});

/** The status rpc, with the env defaults and windows. */
function loadStatus(db: SupabaseClient) {
  const lim = aiLimits();
  return db.rpc("admin_ai_quota_status", {
    p_heavy_default: lim.heavy.limit,
    p_light_default: lim.light.limit,
    p_heavy_window: lim.heavy.interval,
    p_light_window: lim.light.interval,
  });
}

/** A failed rpc: a missing migration says so; anything else is logged and shown as a plain sentence. */
function dbFailure(error: { code?: string; message?: string }, what: string) {
  console.error(`admin quotas: ${what} failed:`, error.message);
  const message = isMissingRelation(error) ? MIGRATION_HINT : "Couldn't load AI limits. Try again.";
  return NextResponse.json({ error: message }, { status: 503 });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A count for the database's int column: null, or a whole number from 0 up. */
const isCount = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2147483647);

const NO_STORE = { "Cache-Control": "no-store" };

/** Every user's limits and calls left, per weight: `{ users, defaults }`. */
export async function GET() {
  const g = await gate();
  if (!g.ok) return g.res;
  const { data, error } = await loadStatus(g.db);
  if (error) return dbFailure(error, "status");
  const lim = aiLimits();
  return NextResponse.json(
    {
      users: ((data ?? []) as StatusRow[]).map(toUser),
      defaults: { heavy: lim.heavy.limit, light: lim.light.limit },
    },
    { headers: NO_STORE },
  );
}

/**
 * Set one user's total (`limit`, null = the env default) and/or calls left (`remaining`, null = leave
 * as is) for one weight. Returns the user's updated row.
 */
export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const body = (await req.json().catch(() => null)) as
    | { userId?: unknown; weight?: unknown; limit?: unknown; remaining?: unknown }
    | null;
  const { userId, weight, limit, remaining } = body ?? {};
  if (
    typeof userId !== "string" ||
    !UUID.test(userId) ||
    (weight !== "heavy" && weight !== "light") ||
    !isCount(limit) ||
    !isCount(remaining)
  ) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const lim = aiLimits()[weight];
  const { error } = await g.db.rpc("admin_set_ai_quota", {
    p_user: userId,
    p_weight: weight,
    p_limit: limit,
    p_default: lim.limit,
    p_remaining: remaining,
    p_window: lim.interval,
  });
  // 23503: no auth user has this id (the ai_quotas foreign key).
  if (error?.code === "23503") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (error) return dbFailure(error, "set");

  const { data, error: readError } = await loadStatus(g.db);
  if (readError) return dbFailure(readError, "status");
  const row = ((data ?? []) as StatusRow[]).find((r) => r.user_id === userId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ user: toUser(row) }, { headers: NO_STORE });
}
