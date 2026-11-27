"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useActionState } from "react";
import { signInWithPassword } from "./actions";
import { Wordmark } from "@/components/icons";
import { LoadingState } from "@/components/ui/loading-state";

// Phone sizes by default; the lg: (1024px+) overrides are the desktop artboard. Field focus rings live in globals.css
// (.login-field), because the global :focus-visible rule would otherwise win over a utility class.
const FIELD =
  "login-field h-12 w-full rounded-lg bg-fg/[0.04] px-3.5 text-base text-fg placeholder:text-muted focus:bg-fg/[0.06] lg:h-11 lg:text-[15px]";
const SUBMIT =
  "flex h-12 w-full items-center justify-center rounded-full bg-accent text-base font-medium text-[#f4f4f5] transition-colors hover:bg-[#2a2a94] disabled:cursor-progress lg:h-11 lg:text-[15px]";

function InviteLink({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[13px] text-muted ${className}`}>
      Have an invite code?{" "}
      <Link href="/signup" className="text-fg underline underline-offset-2">
        Create your account
      </Link>
    </p>
  );
}

/**
 * The sign-in page. `notice` explains why the user landed here (from `?error=`). `preview` is the decorative right
 * column (lg and up), passed in so it stays a server component.
 */
export function LoginForm({ notice, preview }: { notice?: string; preview?: ReactNode }) {
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, { message: "" });

  return (
    <main className="min-h-dvh bg-chrome p-2">
      <div className="grid min-h-[calc(100dvh-1rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.04)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col justify-between px-[22px] pt-6 pb-8 lg:px-14 lg:pt-10">
          <div className="flex items-center justify-between gap-4">
            <Wordmark className="text-[24px] lg:text-[26px]" />
            <InviteLink className="hidden lg:block" />
          </div>

          <div className="flex flex-1 items-center justify-center py-10">
            <form action={pwAction} className="flex w-full max-w-[360px] flex-col gap-6">
              <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] lg:text-[32px]">Welcome back</h1>

              {notice && (
                <p role="alert" className="rounded-lg bg-bad-bg px-3.5 py-2.5 text-[14px] text-bad">
                  {notice}
                </p>
              )}

              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[#525252]">
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
                <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[#525252]">
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
          </div>

          <div className="flex flex-col gap-3">
            <InviteLink className="lg:hidden" />
            <p className="text-[12px] text-muted">Invite-only while in beta.</p>
          </div>
        </div>

        {preview}
      </div>
    </main>
  );
}
