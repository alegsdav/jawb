"use client";

import { useActionState } from "react";
import { updatePassword } from "@/app/login/actions";

/** Set or change the sign-in password (the `updatePassword` server action). */
export function PasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, { message: "" });
  return (
    <form action={action} className="card p-4 space-y-3">
      <input
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        placeholder="New password (8+ characters)"
        className="input w-full"
      />
      <input
        name="confirm"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        placeholder="Confirm password"
        className="input w-full"
      />
      <button disabled={pending} className="btn btn-primary w-full py-2.5">
        {pending ? "Saving…" : "Save password"}
      </button>
      {state.message && <p className={`text-sm ${state.ok ? "text-good" : "text-bad"}`}>{state.message}</p>}
    </form>
  );
}
