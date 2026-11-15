"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signupWithInvite, type InviteAdmin } from "@/lib/invites";

export type SignupState = { message: string; field?: "email" | "password" | "code" };

/** /signup: create an account with an invite code (see signupWithInvite), then open the app. */
export async function signUp(_: SignupState, form: FormData): Promise<SignupState> {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const res = await signupWithInvite(
    {
      admin: createAdminClient() as unknown as InviteAdmin | null,
      signIn: async (email, password) => {
        const supabase = await createClient();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) console.error("signup: sign-in after create failed:", error.message);
        return { error };
      },
    },
    {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      code: String(form.get("code") ?? ""),
      ip,
    },
  );
  if (!res.ok) return { message: res.message, field: res.field };
  // New accounts have an empty master resume, so "/" sends them to onboarding.
  redirect("/");
}
