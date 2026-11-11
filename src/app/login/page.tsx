"use client";

import { useActionState } from "react";
import { sendMagicLink } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(sendMagicLink, { message: "" });
  return (
    <main className="min-h-screen grid place-items-center px-4">
      <form action={action} className="card w-full max-w-sm p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Job Pipeline</h1>
          <p className="text-sm text-muted">Sign in with a magic link.</p>
        </div>
        <input name="email" type="email" required placeholder="you@school.edu" className="input w-full" />
        <button disabled={pending} className="btn btn-primary w-full">
          {pending ? "Sending…" : "Send link"}
        </button>
        {state.message && <p className="text-sm text-muted">{state.message}</p>}
      </form>
    </main>
  );
}
