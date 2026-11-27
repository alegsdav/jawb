/**
 * Who is signed in, as the shell shows them: a display name and an optional picture. profileName is the name the
 * account has set itself (full_name, name…), or "" when it has none; the email fallback in name is not a profile name.
 */
export type Account = { name: string; firstName: string; avatarUrl: string | null; profileName: string };

type UserLike = { email?: string | null; user_metadata?: Record<string, unknown> | null } | null | undefined;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");

/** The name the account has set for itself (full_name, then name, user_name, preferred_username, username), or "". */
export function profileNameFromMetadata(meta: Record<string, unknown> | null | undefined): string {
  const m = meta ?? {};
  return str(m.full_name) || str(m.name) || str(m.user_name) || str(m.preferred_username) || str(m.username);
}

/** True when the account has set a profile name, so onboarding need not ask for one. */
export function hasProfileName(meta: Record<string, unknown> | null | undefined): boolean {
  return profileNameFromMetadata(meta) !== "";
}

export const ACCOUNT_NAME_MAX = 60;

/** Checks a name typed for the account: trimmed, 1 to 60 characters. Returns the trimmed name or why it is refused. */
export function checkAccountName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim();
  if (!name) return { ok: false, error: "Enter a name." };
  if (name.length > ACCOUNT_NAME_MAX) return { ok: false, error: `Keep it to ${ACCOUNT_NAME_MAX} characters or fewer.` };
  return { ok: true, name };
}

/**
 * The name to show for a user: their profile name when the account has one, otherwise the part of their email before
 * the @. firstName is the first word of a profile name, for the greeting.
 */
export function accountFromUser(user: UserLike): Account | null {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  const profile = profileNameFromMetadata(meta);
  const name = profile || (user.email ?? "").split("@")[0] || "You";
  return {
    name,
    firstName: profile ? profile.split(/\s+/)[0] : name,
    avatarUrl: str(meta.avatar_url) || str(meta.picture) || null,
    profileName: profile,
  };
}
