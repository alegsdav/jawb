"use client";

import { useActionState } from "react";
import { signUp, type SignupState } from "./actions";
import { LoadingState } from "@/components/ui/loading-state";
import { FIELD, LABEL, SUBMIT } from "@/components/AuthShell";

/**
 * The sign-up form, rendered inside AuthShell by page.tsx. A failed attempt returns the email and invite code so they
 * stay filled in (React resets the form after an action); the password is never returned, so it is retyped.
 * Errors are announced and point at the field they're about.
 */
export function SignupForm({ initialCode = "" }: { initialCode?: string }) {
  const [state, action, pending] = useActionState<SignupState, FormData>(signUp, { message: "" });
  const invalid = (f: SignupState["field"]) => (state.field === f ? true : undefined);
  const describedBy = (f: SignupState["field"], hint?: string) =>
    [hint, state.field === f ? "signup-error" : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <form action={action} noValidate className="flex w-full max-w-[360px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] lg:text-[32px]">Create your account</h1>
        <p className="text-[15px] text-muted">Use the invite code you were given.</p>
      </div>

      <div className="flex flex-col gap-3">
        <label className={LABEL}>
          Email
          <input
            name="email"
            type="email"
            defaultValue={state.email ?? ""}
            autoComplete="email"
            required
            placeholder="you@school.edu"
            className={FIELD}
            aria-invalid={invalid("email")}
            aria-describedby={describedBy("email")}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <label className={LABEL}>
            Password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              placeholder="Password"
              className={FIELD}
              aria-invalid={invalid("password")}
              aria-describedby={describedBy("password", "signup-password-hint")}
            />
          </label>
          <p id="signup-password-hint" className="text-[12px] text-muted">
            At least 8 characters.
          </p>
        </div>

        <label className={LABEL}>
          Invite code
          <input
            name="code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            defaultValue={state.code ?? initialCode}
            placeholder="ABCD-EFGH-IJKL-MNOP"
            className={`${FIELD} font-mono tracking-wide`}
            aria-invalid={invalid("code")}
            aria-describedby={describedBy("code")}
          />
        </label>
      </div>

      <div className="flex flex-col gap-3">
        <button type="submit" disabled={pending} className={SUBMIT}>
          {pending ? <LoadingState label="Creating your account" className="loading-on-fill" /> : "Create account"}
        </button>
        {state.message && (
          <p id="signup-error" role="alert" className="text-[14px] text-bad">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
