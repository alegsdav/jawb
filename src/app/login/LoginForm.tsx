"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";
import { signInWithPassword } from "./actions";
import { LoadingState } from "@/components/ui/loading-state";
import { AuthShell, AuthTopLink, FIELD, LABEL, SUBMIT } from "@/components/AuthShell";

/**
 * The sign-in page. `notice` explains why the user landed here (from `?error=`). `preview` is the decorative right
 * column (lg and up), passed in so it stays a server component.
 */
export function LoginForm({ notice, preview }: { notice?: string; preview?: ReactNode }) {
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, { message: "" });

  return (
    <AuthShell
      topLink={
        <AuthTopLink lead="Have an invite code?" href="/signup">
          Create your account
        </AuthTopLink>
      }
      preview={preview}
    >
      <form action={pwAction} className="flex w-full max-w-[360px] flex-col gap-6">
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] lg:text-[32px]">Welcome back</h1>

        {notice && (
          <p role="alert" className="rounded-lg bg-bad-bg px-3.5 py-2.5 text-[14px] text-bad">
            {notice}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <label className={LABEL}>
            Email
            <input
              name="email"
              type="email"
              defaultValue={pwState.email ?? ""}
              autoComplete="email"
              required
              placeholder="you@school.edu"
              className={FIELD}
            />
          </label>
          <label className={LABEL}>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="Password"
              className={FIELD}
            />
          </label>
        </div>

        <div className="flex flex-col gap-3">
          <button type="submit" disabled={pwPending} className={SUBMIT}>
            {pwPending ? <LoadingState label="Signing in" className="loading-on-fill" /> : "Sign in"}
          </button>
          {pwState.message && <p className="text-sm text-bad">{pwState.message}</p>}
        </div>
      </form>
    </AuthShell>
  );
}
