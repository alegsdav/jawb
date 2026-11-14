"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { authErrorMessage } from "@/lib/authErrors";
import { isAllowedUser, NOT_ALLOWED_MESSAGE } from "@/lib/supabase/allowlist";

type State = { message: string; ok?: boolean };

export async function signInWithPassword(_: State, form: FormData): Promise<State> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email) return { message: "Enter your email." };
  if (!password) return { message: "Enter your password." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("sign-in failed:", error.message);
    return { message: authErrorMessage(error, "sign-in") };
  }
  // Invited accounts and ALLOWED_EMAILS only (the same check middleware makes on every request).
  if (!isAllowedUser(data.user)) {
    await supabase.auth.signOut().catch(() => {});
    return { message: NOT_ALLOWED_MESSAGE };
  }
  redirect("/");
}

/** Fallback for a forgotten or never-set password: one-time sign-in link. */
export async function sendMagicLink(_: State, form: FormData): Promise<State> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email) return { message: "Enter your email." };
  // Existing accounts only (shouldCreateUser: false); middleware signs out anyone not allowed.
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback?next=/account`, shouldCreateUser: false },
  });
  if (error) console.error("magic link failed:", error.message);
  return error
    ? { message: authErrorMessage(error, "link") }
    : { message: "Check your inbox. The link signs you in and opens Account so you can set a password.", ok: true };
}

export async function updatePassword(_: State, form: FormData): Promise<State> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 8) return { message: "Use at least 8 characters." };
  if (password !== confirm) return { message: "Passwords don't match." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) console.error("password update failed:", error.message);
  return error ? { message: authErrorMessage(error, "password") } : { message: "Password saved. You can sign in with it from now on.", ok: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
