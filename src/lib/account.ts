/** Who is signed in, as the shell shows them: a display name and an optional picture. */
export type Account = { name: string; firstName: string; avatarUrl: string | null };

type UserLike = { email?: string | null; user_metadata?: Record<string, unknown> | null } | null | undefined;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");

/**
 * The name to show for a user: their profile name when the account has one (full_name, name, user_name), otherwise
 * the part of their email before the @. firstName is the first word of a profile name, for the greeting.
 */
export function accountFromUser(user: UserLike): Account | null {
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  const profile = str(meta.full_name) || str(meta.name) || str(meta.user_name) || str(meta.preferred_username) || str(meta.username);
  const name = profile || (user.email ?? "").split("@")[0] || "You";
  return {
    name,
    firstName: profile ? profile.split(/\s+/)[0] : name,
    avatarUrl: str(meta.avatar_url) || str(meta.picture) || null,
  };
}
