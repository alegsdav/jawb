/**
 * Who may open /admin (edit each user's AI limits). Same shape as `@/lib/supabase/allowlist` (no
 * Next.js or Node imports): ADMIN_EMAILS is comma-separated and case-insensitive. An empty list means
 * nobody is an admin.
 */
import { allowedEmails, isListedEmail } from "./supabase/allowlist";

export function adminEmails(raw = process.env.ADMIN_EMAILS): string[] {
  return allowedEmails(raw);
}

export function isAdminEmail(email: string | null | undefined, raw = process.env.ADMIN_EMAILS): boolean {
  return isListedEmail(email, raw);
}
