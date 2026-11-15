/**
 * Who may use the app (no Next.js or Node imports: middleware runs on the Edge runtime):
 * - accounts created through /signup with an invite code (`app_metadata.invited === true`, set by the
 *   server with the service-role key; users can't change app_metadata themselves), and
 * - emails on ALLOWED_EMAILS (comma-separated, case-insensitive), so the owner's account made before
 *   invites existed keeps working.
 * Checked after sign-in, in middleware on every request and in requireUser() for API routes. Everyone
 * else is signed out, so an account created some other way (e.g. sign-ups left on) can't use the app.
 */
export function allowedEmails(raw = process.env.ALLOWED_EMAILS): string[] {
  return (raw ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** True when ALLOWED_EMAILS is empty (the old "anyone with an account") or lists this email. */
export function isAllowedEmail(email: string | null | undefined, raw = process.env.ALLOWED_EMAILS): boolean {
  const list = allowedEmails(raw);
  if (!list.length) return true;
  return isListedEmail(email, raw);
}

/** True only when ALLOWED_EMAILS names this email (an empty list names nobody). */
export function isListedEmail(email: string | null | undefined, raw = process.env.ALLOWED_EMAILS): boolean {
  return !!email && allowedEmails(raw).includes(email.trim().toLowerCase());
}

type UserLike = { email?: string | null; app_metadata?: Record<string, unknown> | null } | null | undefined;

/**
 * Whether a signed-in user may use the app: invited (from the session's app_metadata, no database
 * call) or listed in ALLOWED_EMAILS. With invites, an empty ALLOWED_EMAILS no longer lets everyone in.
 */
export function isAllowedUser(user: UserLike, raw = process.env.ALLOWED_EMAILS): boolean {
  if (!user) return false;
  return user.app_metadata?.invited === true || isListedEmail(user.email, raw);
}

/** `/login?error=…` code for a signed-in account that isn't on the list, and the message shown for it. */
export const NOT_ALLOWED_ERROR = "not-allowed";
export const NOT_ALLOWED_MESSAGE = "That account isn't allowed to use this app, so it was signed out.";
