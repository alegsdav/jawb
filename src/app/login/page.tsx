"use client";

import { useActionState, useState } from "react";
import { sendMagicLink, signInWithPassword } from "./actions";

export default function LoginPage() {
  const [mode, setMode] = useState<"password" | "link">("password");
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, { message: "" });
  const [linkState, linkAction, linkPending] = useActionState(sendMagicLink, { message: "" });

  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="card w-full max-w-sm p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Job Pipeline</h1>
          <p className="text-sm text-muted">
            {mode === "password" ? "Sign in to your account." : "Get a one-time sign-in link by email."}
          </p>
        </div>

        {mode === "password" ? (
          <form action={pwAction} className="space-y-3">
            <input name="email" type="email" autoComplete="email" required placeholder="Email" className="input w-full" />
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="Password"
              className="input w-full"
            />
            <button disabled={pwPending} className="btn btn-primary w-full py-2.5">
              {pwPending ? "Signing in…" : "Sign in"}
            </button>
            {pwState.message && <p className="text-sm text-bad">{pwState.message}</p>}
          </form>
        ) : (
          <form action={linkAction} className="space-y-3">
            <input name="email" type="email" autoComplete="email" required placeholder="Email" className="input w-full" />
            <button disabled={linkPending} className="btn btn-primary w-full py-2.5">
              {linkPending ? "Sending…" : "Email me a sign-in link"}
            </button>
            {linkState.message && (
              <p className={`text-sm ${linkState.ok ? "text-muted" : "text-bad"}`}>{linkState.message}</p>
            )}
          </form>
        )}

        <button
          type="button"
          className="text-sm text-muted hover:text-fg underline underline-offset-2"
          onClick={() => setMode(mode === "password" ? "link" : "password")}
        >
          {mode === "password" ? "Forgot or never set a password? Email me a sign-in link" : "Back to password sign-in"}
        </button>
      </div>
    </main>
  );
}
