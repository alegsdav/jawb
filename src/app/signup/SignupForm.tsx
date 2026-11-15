"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUp, type SignupState } from "./actions";

/** Email, password and invite code. Errors are announced and point at the field they're about. */
export function SignupForm({ initialCode = "" }: { initialCode?: string }) {
  const [state, action, pending] = useActionState<SignupState, FormData>(signUp, { message: "" });
  const invalid = (f: SignupState["field"]) => (state.field === f ? true : undefined);

  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="card w-full max-w-sm p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Create your account</h1>
          <p className="text-sm text-muted">Job Pipeline is invite-only. Use the code you were given.</p>
        </div>
        <form action={action} className="space-y-3" noValidate>
          <div className="space-y-1">
            <label htmlFor="signup-email" className="text-sm font-medium">Email</label>
            <input
              id="signup-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="input w-full"
              aria-invalid={invalid("email")}
              aria-describedby={state.field === "email" ? "signup-error" : undefined}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="signup-password" className="text-sm font-medium">Password</label>
            <input
              id="signup-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className="input w-full"
              aria-invalid={invalid("password")}
              aria-describedby="signup-password-hint"
            />
            <p id="signup-password-hint" className="text-xs text-muted">At least 8 characters.</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="signup-code" className="text-sm font-medium">Invite code</label>
            <input
              id="signup-code"
              name="code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              defaultValue={initialCode}
              placeholder="ABCD-EFGH-IJKL-MNOP"
              className="input w-full font-mono tracking-wide"
              aria-invalid={invalid("code")}
              aria-describedby={state.field === "code" ? "signup-error" : undefined}
            />
          </div>
          <button disabled={pending} className="btn btn-primary w-full py-2.5">
            {pending ? "Creating your account…" : "Create account"}
          </button>
          {state.message && (
            <p id="signup-error" role="alert" className="text-sm text-bad">
              {state.message}
            </p>
          )}
        </form>
        <p className="text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="underline underline-offset-2 hover:text-fg">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
