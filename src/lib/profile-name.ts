import { checkAccountName } from "@/lib/account";
import { createClient } from "@/lib/supabase/client";

/** Set when someone skips the "What should we call you?" step, so onboarding doesn't ask again on this device. */
export const NAME_SKIPPED_KEY = "jawb_name_skipped";

export function readNameSkipped(): boolean {
  try {
    return localStorage.getItem(NAME_SKIPPED_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberNameSkipped(): void {
  try {
    localStorage.setItem(NAME_SKIPPED_KEY, "1");
  } catch {
    /* storage unavailable: they may see the step again on a later visit */
  }
}

/**
 * Saves the account's profile name (user_metadata.full_name) from the browser. Returns the message to show, or null
 * when saved. The caller refreshes the router so the server layout re-reads the user (sidebar and greeting).
 */
export async function saveProfileName(raw: string): Promise<string | null> {
  const v = checkAccountName(raw);
  if (!v.ok) return v.error;
  try {
    const { error } = await createClient().auth.updateUser({ data: { full_name: v.name } });
    return error ? "Couldn't save your name. Try again." : null;
  } catch {
    return "Couldn't save your name. Try again.";
  }
}
