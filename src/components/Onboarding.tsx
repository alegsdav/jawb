"use client";

import type { Resume } from "@/lib/types";
import { ResumeImport } from "./ResumeImport";

/**
 * First visit with an empty master resume: three ways to start, as cards. Pasting or uploading uses
 * the resume import (one of the day's analyses); "I don't have a resume yet" opens the guided builder.
 */
export function Onboarding({ onImported, onBuild }: { onImported: (r: Resume) => void; onBuild: () => void }) {
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
          <p className="text-sm text-muted">Copy the text from Word, Google Docs or a PDF and paste it here.</p>
          <ResumeImport replaceWarning={false} onImported={onImported} mode="text" />
        </section>
        <section className="card p-4 sm:p-5 space-y-3" aria-labelledby="ob-upload">
          <h3 id="ob-upload" className="font-semibold">Upload a PDF</h3>
          <p className="text-sm text-muted">We rebuild it as a one-page Harvard-style document with your exact wording.</p>
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
