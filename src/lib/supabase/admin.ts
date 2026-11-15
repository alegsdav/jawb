import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client with the service-role key: bypasses RLS. Server-only (the import above makes a
 * client bundle that pulls this in fail to build). Used only for invite codes, sign-up throttling and
 * creating invited accounts. The key is never logged or sent to the browser.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
