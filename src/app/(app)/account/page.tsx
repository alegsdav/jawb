"use client";

import { useActionState } from "react";
import { updatePassword } from "../../login/actions";

export default function AccountPage() {
  const [state, action, pending] = useActionState(updatePassword, { message: "" });
  return (
    <div className="max-w-sm mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Account</h1>
        <p className="text-sm text-muted">Set or change the password you sign in with.</p>
      </div>
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

      <section className="card p-4 space-y-2">
        <h2 className="font-semibold">Export your data</h2>
        <p className="text-sm text-muted">
          Downloads a JSON backup of your resumes (including extra facts) and every job you&apos;ve tracked.
        </p>
        <a href="/api/export" download className="btn w-full py-2.5">
          Download backup (.json)
        </a>
      </section>
    </div>
  );
}
