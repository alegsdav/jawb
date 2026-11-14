/**
 * Invite-only sign-up (migration 0004). Public sign-ups stay OFF in Supabase (the anon key is public);
 * /signup checks an invite code on the server and creates the account with the service-role key.
 *
 * The flow (signupWithInvite) is plain logic over a small client interface so it's unit-tested with a
 * fake: validate → throttle by IP → redeem one use atomically (the redeem_invite SQL function) →
 * create the account (email confirmed, app_metadata.invited = true) → sign in. If creating the account
 * fails after the code was redeemed, the use is given back (release_invite).
 */

/** RFC 4648 base32. Codes are 16 of these (80 random bits), shown in groups of four. */
export const INVITE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const INVITE_CODE_LENGTH = 16;
/** Codes are at least this long; anything shorter is refused without a database call. */
export const MIN_INVITE_CODE_LENGTH = 12;

/** Block an IP after this many wrong codes in the window. */
export const THROTTLE = { maxFailures: 5, windowMs: 10 * 60 * 1000 };

/** Canonical form of a typed code: upper case, no spaces or dashes; 0/1/8 read as O/I/B (base32 has none). */
export function normalizeInviteCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/8/g, "B")
    .replace(/[^A-Z2-7]/g, "");
}

/** "ABCDEFGHIJKLMNOP" -> "ABCD-EFGH-IJKL-MNOP". */
export const formatInviteCode = (code: string) => code.match(/.{1,4}/g)?.join("-") ?? code;

/** A new random code (crypto randomness; 256 is a multiple of 32, so every letter is equally likely). */
export function generateInviteCode(length = INVITE_CODE_LENGTH): string {
  const bytes = new Uint8Array(Math.max(length, MIN_INVITE_CODE_LENGTH));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => INVITE_ALPHABET[b % 32]).join("");
}

/** SHA-256 of the IP (hex), so the attempts table never stores raw addresses. */
export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`signup:${ip || "unknown"}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- messages (plain sentences, shown on the form) ----------

export const SIGNUP_MESSAGES = {
  email: "Enter a valid email address.",
  password: "Use at least 8 characters for your password.",
  code: "That invite code isn't valid, has been used up or has expired. Check it and try again.",
  throttled: "Too many wrong invite codes from this connection. Wait 10 minutes and try again.",
  exists: "An account with that email already exists. Sign in instead.",
  weakPassword: "Choose a stronger password (at least 8 characters, not a common one).",
  notConfigured: "Sign-ups aren't set up on this server yet. Ask the person who invited you.",
  failed: "Couldn't create your account. Check your connection and try again.",
  signInAfter: "Your account was created, but signing in failed. Sign in with your email and password.",
} as const;

// ---------- the flow ----------

type DbError = { code?: string; message?: string } | null;
type AuthError = { code?: string; status?: number; message?: string } | null;

/** The parts of the service-role Supabase client the flow uses. */
export type InviteAdmin = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbError }>;
  from: (table: string) => {
    select: (
      cols: string,
      opts: { count: "exact"; head: true },
    ) => { eq: (k: string, v: unknown) => { gte: (k: string, v: unknown) => PromiseLike<{ count: number | null; error: DbError }> } };
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: DbError }>;
  };
  auth: {
    admin: {
      createUser: (attrs: {
        email: string;
        password: string;
        email_confirm: boolean;
        app_metadata: Record<string, unknown>;
      }) => PromiseLike<{ data: { user: { id: string } | null }; error: AuthError }>;
    };
  };
};

export type SignupInput = { email: string; password: string; code: string; ip: string };
export type SignupResult = { ok: true } | { ok: false; message: string; field?: "email" | "password" | "code" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const missingSetup = (e: DbError) =>
  !!e && (e.code === "42883" || e.code === "42P01" || e.code === "PGRST202" || e.code === "PGRST205");

async function failuresSince(admin: InviteAdmin, ipHash: string, since: Date): Promise<number> {
  const { count, error } = await admin
    .from("signup_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since.toISOString());
  if (error) {
    console.warn("signup: throttle check failed:", error.message);
    return 0; // the code check itself still protects sign-up
  }
  return count ?? 0;
}

async function recordFailure(admin: InviteAdmin, ipHash: string) {
  const { error } = await admin.from("signup_attempts").insert({ ip_hash: ipHash });
  if (error) console.warn("signup: couldn't record a failed attempt:", error.message);
}

function createUserMessage(e: AuthError): string {
  const text = `${e?.code ?? ""} ${e?.message ?? ""}`;
  if (/email_exists|user_already_exists|already (?:been )?registered|already exists/i.test(text)) return SIGNUP_MESSAGES.exists;
  if (/weak_password|password/i.test(text)) return SIGNUP_MESSAGES.weakPassword;
  return SIGNUP_MESSAGES.failed;
}

/**
 * Create an invited account. `signIn` signs the new user in (sets the session cookies). Never throws
 * for expected failures; returns a plain sentence and the field it's about.
 */
export async function signupWithInvite(
  deps: {
    admin: InviteAdmin | null;
    signIn: (email: string, password: string) => Promise<{ error: unknown }>;
    now?: () => Date;
  },
  input: SignupInput,
): Promise<SignupResult> {
  const email = input.email.trim().toLowerCase();
  const code = normalizeInviteCode(input.code);
  if (!EMAIL_RE.test(email)) return { ok: false, message: SIGNUP_MESSAGES.email, field: "email" };
  if (input.password.length < 8) return { ok: false, message: SIGNUP_MESSAGES.password, field: "password" };
  const { admin } = deps;
  if (!admin) return { ok: false, message: SIGNUP_MESSAGES.notConfigured };

  const now = deps.now?.() ?? new Date();
  const ipHash = await hashIp(input.ip);
  if ((await failuresSince(admin, ipHash, new Date(now.getTime() - THROTTLE.windowMs))) >= THROTTLE.maxFailures) {
    return { ok: false, message: SIGNUP_MESSAGES.throttled, field: "code" };
  }
  if (code.length < MIN_INVITE_CODE_LENGTH) {
    await recordFailure(admin, ipHash);
    return { ok: false, message: SIGNUP_MESSAGES.code, field: "code" };
  }

  const redeemed = await admin.rpc("redeem_invite", { p_code: code });
  if (redeemed.error) {
    console.error("signup: redeem_invite failed:", redeemed.error.message);
    return { ok: false, message: missingSetup(redeemed.error) ? SIGNUP_MESSAGES.notConfigured : SIGNUP_MESSAGES.failed };
  }
  if (redeemed.data !== true) {
    await recordFailure(admin, ipHash);
    return { ok: false, message: SIGNUP_MESSAGES.code, field: "code" };
  }

  let created: Awaited<ReturnType<InviteAdmin["auth"]["admin"]["createUser"]>> | null = null;
  try {
    created = await admin.auth.admin.createUser({ email, password: input.password, email_confirm: true, app_metadata: { invited: true } });
  } catch (e) {
    console.error("signup: createUser threw:", e instanceof Error ? e.message : e);
  }
  if (!created || created.error || !created.data.user) {
    // Give the use back so a typo'd email or a hiccup doesn't burn a single-use code.
    const back = await admin.rpc("release_invite", { p_code: code });
    if (back.error) console.error("signup: release_invite failed:", back.error.message);
    if (created?.error) console.error("signup: createUser failed:", created.error.code ?? created.error.message);
    const message = createUserMessage(created?.error ?? null);
    const field = message === SIGNUP_MESSAGES.exists ? "email" : message === SIGNUP_MESSAGES.weakPassword ? "password" : undefined;
    return { ok: false, message, field };
  }

  const { error } = await deps.signIn(email, input.password);
  if (error) return { ok: false, message: SIGNUP_MESSAGES.signInAfter };
  return { ok: true };
}
