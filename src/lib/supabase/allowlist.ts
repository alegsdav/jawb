/**
 * The ALLOWED_EMAILS allow-list (comma-separated, case-insensitive). Empty or unset = anyone with an
 * account may use the app. Enforced at sign-in, in middleware on every request, and in requireUser()
 * for API routes, so an account created some other way (e.g. sign-ups left on in Supabase) can't use it.
 * No Next.js or Node imports: middleware runs on the Edge runtime.
 */
export function allowedEmails(raw = process.env.ALLOWED_EMAILS): string[] {
  return (raw ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined, raw = process.env.ALLOWED_EMAILS): boolean {
  const list = allowedEmails(raw);
  if (!list.length) return true;
  return !!email && list.includes(email.trim().toLowerCase());
}

/** `/login?error=…` code for a signed-in account that isn't on the list, and the message shown for it. */
export const NOT_ALLOWED_ERROR = "not-allowed";
export const NOT_ALLOWED_MESSAGE = "That account isn't allowed to use this app, so it was signed out.";
