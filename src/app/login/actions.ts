"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function sendMagicLink(_: unknown, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!email) return { message: "Enter your email." };
  if (allowed.length && !allowed.includes(email)) {
    return { message: "That email isn't allowed to sign in." };
  }
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  return { message: error ? error.message : "Check your inbox for a sign-in link." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
