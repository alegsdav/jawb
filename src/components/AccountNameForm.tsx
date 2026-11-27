"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { checkAccountName } from "@/lib/account";
import { saveProfileName } from "@/lib/profile-name";
import { LoadingState } from "@/components/ui/loading-state";

/** The account's name (shown in the greeting and the sidebar). Saves to the profile, then refreshes the server layout. */
export function AccountNameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const v = checkAccountName(name);
    if (!v.ok) return setMessage({ ok: false, text: v.error });
    setSaving(true);
    setMessage(null);
    const failed = await saveProfileName(v.name);
    setSaving(false);
    if (failed) return setMessage({ ok: false, text: failed });
    setName(v.name);
    setMessage({ ok: true, text: "Saved. Your greeting and sidebar show this name now." });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="account-name-input" className="sr-only">Name</label>
      <input
        id="account-name-input"
        className="input w-full"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        autoComplete="name"
        disabled={saving}
      />
      <button type="submit" className="btn btn-primary w-full py-2.5" disabled={saving}>
        {saving ? <LoadingState label="Saving" className="loading-on-fill" /> : "Save name"}
      </button>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-good" : "text-bad"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
