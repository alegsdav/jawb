"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Resume } from "@/lib/types";
import { checkAccountName } from "@/lib/account";
import { useAccount } from "@/components/account";
import { LoadingState } from "@/components/ui/loading-state";
import { readNameSkipped, rememberNameSkipped, saveProfileName } from "@/lib/profile-name";
import { ResumeImport, type ImportSource } from "./ResumeImport";

/**
 * "What should we call you?": the first onboarding step when the account has no profile name. The name is used in the
 * greeting and the sidebar, and can be changed on the Account page.
 */
function NameStep({ onSaved, onSkip }: { onSaved: () => void; onSkip: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const v = checkAccountName(name);
    if (!v.ok) return setError(v.error);
    setSaving(true);
    setError("");
    const failed = await saveProfileName(v.name);
    setSaving(false);
    if (failed) return setError(failed);
    onSaved();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card p-4 sm:p-6 space-y-4 max-w-xl" aria-labelledby="ob-name">
      <div className="space-y-1">
        <p className="label">Welcome</p>
        <h2 id="ob-name" className="text-xl sm:text-2xl font-semibold">What should we call you?</h2>
        <p className="text-sm text-muted">We use it in your greeting and the sidebar. You can change it later on the Account page.</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="ob-name-input" className="sr-only">Your name</label>
        <input
          id="ob-name-input"
          className={`input w-full ${error ? "border-bad" : ""}`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError("");
          }}
          placeholder="Your name"
          autoComplete="name"
          autoFocus
          disabled={saving}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "ob-name-error" : undefined}
        />
        {error && <p id="ob-name-error" role="alert" className="text-xs text-bad">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary min-h-10 w-full sm:w-auto sm:min-w-32" disabled={saving}>
          {saving ? <LoadingState label="Saving" className="loading-on-fill" /> : "Continue"}
        </button>
        <button
          type="button"
          className="min-h-10 px-2 text-sm text-muted underline underline-offset-4 hover:text-fg disabled:opacity-50"
          disabled={saving}
          onClick={onSkip}
        >
          Skip
        </button>
      </div>
    </form>
  );
}

/**
 * First visit with an empty master resume: first asks what to call the user (unless the account already has a name, or
 * they skipped that before), then three ways to start, as cards. Pasting or uploading uses
 * the resume import, which keeps the text and formatting as they are; "I don't have a resume yet" opens the guided builder.
 */
export function Onboarding({
  onImported, onBuild,
}: { onImported: (r: Resume, source?: ImportSource) => void; onBuild: () => void }) {
  const account = useAccount();
  const [nameSaved, setNameSaved] = useState(false);
  const [nameSkipped, setNameSkipped] = useState(readNameSkipped);
  if (!nameSaved && !nameSkipped && !account?.profileName) {
    return (
      <NameStep
        onSaved={() => setNameSaved(true)}
        onSkip={() => {
          rememberNameSkipped();
          setNameSkipped(true);
        }}
      />
    );
  }
  return (
    <div className="space-y-5 max-w-5xl">
      <div className="space-y-1">
        <p className="label">Welcome</p>
        <h2 className="text-xl sm:text-2xl font-semibold">Let&apos;s set up your master resume</h2>
        <p className="text-sm text-muted max-w-2xl">
          It&apos;s the one place everything true about you lives. Every job you add gets its own tailored copy, and the
          coach helps you make each line stronger. Pick how to start:
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <section className="card p-4 sm:p-5 space-y-3" aria-labelledby="ob-paste">
          <h3 id="ob-paste" className="font-semibold">Paste your resume</h3>
          <p className="text-sm text-muted">Copy the text from Word, Google Docs or a PDF and paste it here. The AI lays it out in the Harvard template (uses one of your daily AI analyses).</p>
          <ResumeImport replaceWarning={false} onImported={onImported} mode="text" />
        </section>
        <section className="card p-4 sm:p-5 space-y-3" aria-labelledby="ob-upload">
          <h3 id="ob-upload" className="font-semibold">Upload a PDF or Word file</h3>
          <p className="text-sm text-muted">Opens exactly as it looks: the fonts, sizes, bold, lines and margins are kept, as text you can edit. No AI, no template. A Word (.docx) file is the most accurate.</p>
          <ResumeImport replaceWarning={false} onImported={onImported} mode="file" />
        </section>
        <section className="card p-4 sm:p-5 space-y-3 flex flex-col" aria-labelledby="ob-build">
          <h3 id="ob-build" className="font-semibold">I don&apos;t have a resume yet</h3>
          <p className="text-sm text-muted flex-1">
            Answer a few questions about school, what you&apos;ve done and what you know. We&apos;ll draft a first resume using
            only your words, about 10 minutes.
          </p>
          <button type="button" className="btn btn-primary w-full min-h-10" onClick={onBuild}>
            Start building
          </button>
        </section>
      </div>
    </div>
  );
}
