/** Plain-language versions of Supabase Auth errors (never show the raw message). */
export function authErrorMessage(
  e: { message?: string; status?: number; code?: string } | null | undefined,
  action: "sign-in" | "link" | "password",
): string {
  const msg = e?.message ?? "";
  if (e?.status === 429 || /rate limit|only request this after|too many/i.test(msg)) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (action === "sign-in" && /invalid login|invalid credentials/i.test(msg)) {
    return 'Wrong email or password. No password yet? Use "Email me a sign-in link" below, then set one under Account.';
  }
  if (/email not confirmed/i.test(msg)) return "Confirm your email first: check your inbox for the confirmation link.";
  if (action === "link" && /signups? not allowed|user not found|not found/i.test(msg)) {
    return "There's no account for that email yet.";
  }
  if (action === "password") {
    if (/different from the old|same as the old|should be different/i.test(msg)) return "Pick a password you haven't used here before.";
    if (/weak|at least|characters|pwned|compromised/i.test(msg)) return "That password is too weak. Try a longer one.";
    if (/session|jwt|not authenticated|auth session missing/i.test(msg)) return "You've been signed out. Sign in again, then set your password.";
  }
  if (/fetch failed|network|ECONN|ETIMEDOUT|upstream/i.test(msg)) return "Couldn't reach the sign-in service. Check your connection and try again.";
  return action === "password"
    ? "Couldn't save your password. Try again in a moment."
    : "Couldn't sign you in right now. Try again in a moment.";
}
