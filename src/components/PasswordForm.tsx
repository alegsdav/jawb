"use client";

import { useActionState, useId, useState } from "react";
import { updatePassword } from "@/app/login/actions";

/** Set or change the sign-in password (the `updatePassword` server action). Behind a disclosure button. */
export function PasswordForm() {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const [state, action, pending] = useActionState(updatePassword, { message: "" });
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <button
        type="button"
        className="text-sm font-medium"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => setOpen((o) => !o)}
      >
        Change password
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
            {pending ? "Saving…" : "Save password"}
          </button>
          {state.message && <p className={`text-sm ${state.ok ? "text-good" : "text-bad"}`}>{state.message}</p>}
        </form>
      )}
    </div>
  );
}
