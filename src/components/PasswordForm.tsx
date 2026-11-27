"use client";

import { useActionState, useId, useState } from "react";
import { updatePassword } from "@/app/login/actions";
import { LoadingState } from "@/components/ui/loading-state";

/** Set or change the sign-in password (the `updatePassword` server action). Behind a disclosure button. */
export function PasswordForm() {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const [state, action, pending] = useActionState(updatePassword, { message: "" });
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <button
        type="button"
        className="btn btn-sm font-medium"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => setOpen((o) => !o)}
      >
        Change password
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
      {open && (
        <form id={formId} action={action} className="space-y-3">
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
            {pending ? <LoadingState label="Saving" className="loading-on-fill" /> : "Save password"}
          </button>
          {state.message && <p className={`text-sm ${state.ok ? "text-good" : "text-bad"}`}>{state.message}</p>}
        </form>
      )}
    </div>
  );
}
