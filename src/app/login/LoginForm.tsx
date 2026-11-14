"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { sendMagicLink, signInWithPassword } from "./actions";

/** Password sign-in with a magic-link fallback. `notice` explains why the user landed here (from `?error=`). */
export function LoginForm({ notice }: { notice?: string }) {
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

        {notice && (
          <p role="alert" className="rounded-lg border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad">
            {notice}
          </p>
        )}

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
        <p className="text-sm text-muted border-t border-border pt-3">
          Got an invite code?{" "}
          <Link href="/signup" className="underline underline-offset-2 hover:text-fg">Create your account</Link>
        </p>
      </div>
    </main>
  );
}
